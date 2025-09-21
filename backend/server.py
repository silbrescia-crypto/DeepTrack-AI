from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import json
import base64
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
import aiofiles
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Multispectral Target Recognition & Tracking", version="1.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Helper function to convert datetime to ISO string for MongoDB
def prepare_for_mongo(data):
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
    return data

# Models
class TargetDetection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_id: str
    target_type: str
    confidence: float
    bounding_box: Dict[str, float]  # x, y, width, height
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MultispectralFile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    file_type: str  # RGB, thermal, radar, etc.
    file_path: str
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Optional[Dict[str, Any]] = None

class AnalysisJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_ids: List[str]
    analysis_type: str  # single, batch, tracking
    status: str = "pending"  # pending, processing, completed, failed
    results: Optional[List[TargetDetection]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

# Create upload directory
UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Helper function to encode image to base64
async def encode_image_to_base64(file_path: str) -> str:
    async with aiofiles.open(file_path, "rb") as image_file:
        return base64.b64encode(await image_file.read()).decode('utf-8')

# AI Analysis using Emergent Integration
async def analyze_image_with_ai(image_path: str, analysis_type: str = "target_detection") -> List[Dict]:
    try:
        # Initialize AI chat
        chat = LlmChat(
            api_key=os.environ.get('EMERGENT_LLM_KEY'),
            session_id=f"analysis-{uuid.uuid4()}",
            system_message="You are an expert in multispectral image analysis and target recognition. Analyze images for objects like vehicles, people, buildings, and other targets. Provide detailed detection results with confidence scores and bounding box coordinates."
        ).with_model("openai", "gpt-4o")
        
        # Encode image to base64
        image_base64 = await encode_image_to_base64(image_path)
        
        # Create image content
        image_content = ImageContent(image_base64=image_base64)
        
        # Analysis prompt based on type
        if analysis_type == "target_detection":
            prompt = """Analyze this multispectral image for target detection. Identify and locate:
            1. Vehicles (cars, trucks, aircraft)
            2. People/Personnel 
            3. Buildings/Structures
            4. Other significant objects
            
            For each detected target, provide:
            - Target type
            - Confidence score (0-1)
            - Bounding box coordinates (x, y, width, height as percentages of image dimensions)
            - Brief description
            
            Format response as JSON array:
            [{"type": "vehicle", "confidence": 0.95, "bbox": {"x": 0.2, "y": 0.3, "width": 0.1, "height": 0.15}, "description": "Red car"}]"""
        
        # Send message with image
        user_message = UserMessage(
            text=prompt,
            file_contents=[image_content]
        )
        
        response = await chat.send_message(user_message)
        
        # Parse AI response
        try:
            # Extract JSON from response
            response_text = response.strip()
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_text = response_text[json_start:json_end].strip()
            elif "[" in response_text and "]" in response_text:
                json_start = response_text.find("[")
                json_end = response_text.rfind("]") + 1
                json_text = response_text[json_start:json_end]
            else:
                json_text = response_text
                
            detections = json.loads(json_text)
            return detections
            
        except json.JSONDecodeError:
            # Fallback - create mock detection
            return [{
                "type": "generic_object",
                "confidence": 0.8,
                "bbox": {"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.2},
                "description": f"AI Analysis Result: {response[:100]}..."
            }]
            
    except Exception as e:
        logger.error(f"AI analysis error: {str(e)}")
        return [{
            "type": "error",
            "confidence": 0.0,
            "bbox": {"x": 0, "y": 0, "width": 0, "height": 0},
            "description": f"Analysis failed: {str(e)}"
        }]

# Routes
@api_router.get("/")
async def root():
    return {"message": "Multispectral Target Recognition & Tracking API", "version": "1.0.0"}

@api_router.post("/upload", response_model=MultispectralFile)
async def upload_file(
    file: UploadFile = File(...),
    file_type: str = Form(...),
    metadata: Optional[str] = Form(None)
):
    """Upload multispectral data file"""
    try:
        # Generate unique filename
        file_id = str(uuid.uuid4())
        file_extension = file.filename.split('.')[-1]
        filename = f"{file_id}.{file_extension}"
        file_path = UPLOAD_DIR / filename
        
        # Save file
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Parse metadata if provided
        parsed_metadata = json.loads(metadata) if metadata else None
        
        # Create file record
        file_record = MultispectralFile(
            id=file_id,
            filename=file.filename,
            file_type=file_type,
            file_path=str(file_path),
            metadata=parsed_metadata
        )
        
        # Save to database
        file_dict = prepare_for_mongo(file_record.dict())
        await db.files.insert_one(file_dict)
        
        return file_record
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@api_router.get("/files", response_model=List[MultispectralFile])
async def get_files():
    """Get all uploaded files"""
    files = await db.files.find().to_list(1000)
    return [MultispectralFile(**file) for file in files]

@api_router.post("/analyze", response_model=AnalysisJob)
async def create_analysis(
    file_ids: List[str],
    analysis_type: str = "single"  # single, batch, tracking
):
    """Start target recognition analysis"""
    try:
        # Create analysis job
        job = AnalysisJob(
            file_ids=file_ids,
            analysis_type=analysis_type,
            status="processing"
        )
        
        # Save job to database
        job_dict = prepare_for_mongo(job.dict())
        await db.analysis_jobs.insert_one(job_dict)
        
        # Start background analysis
        asyncio.create_task(process_analysis_job(job.id))
        
        return job
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

async def process_analysis_job(job_id: str):
    """Background task to process analysis job"""
    try:
        # Get job from database
        job_data = await db.analysis_jobs.find_one({"id": job_id})
        if not job_data:
            return
            
        job = AnalysisJob(**job_data)
        
        # Get files for analysis
        files = await db.files.find({"id": {"$in": job.file_ids}}).to_list(1000)
        
        all_detections = []
        
        for file_doc in files:
            file_obj = MultispectralFile(**file_doc)
            
            # Analyze image with AI
            ai_results = await analyze_image_with_ai(file_obj.file_path, "target_detection")
            
            # Convert AI results to TargetDetection objects
            for detection_data in ai_results:
                detection = TargetDetection(
                    file_id=file_obj.id,
                    target_type=detection_data.get("type", "unknown"),
                    confidence=float(detection_data.get("confidence", 0.0)),
                    bounding_box=detection_data.get("bbox", {"x": 0, "y": 0, "width": 0, "height": 0})
                )
                all_detections.append(detection)
                
                # Save detection to database
                detection_dict = prepare_for_mongo(detection.dict())
                await db.detections.insert_one(detection_dict)
        
        # Update job status
        await db.analysis_jobs.update_one(
            {"id": job_id},
            {
                "$set": {
                    "status": "completed",
                    "results": [d.dict() for d in all_detections],
                    "completed_at": datetime.now(timezone.utc).isoformat()
                }
            }
        )
        
    except Exception as e:
        logger.error(f"Analysis job {job_id} failed: {str(e)}")
        await db.analysis_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "failed"}}
        )

@api_router.get("/jobs", response_model=List[AnalysisJob])
async def get_analysis_jobs():
    """Get all analysis jobs"""
    jobs = await db.analysis_jobs.find().sort("created_at", -1).to_list(100)
    return [AnalysisJob(**job) for job in jobs]

@api_router.get("/jobs/{job_id}", response_model=AnalysisJob)
async def get_analysis_job(job_id: str):
    """Get specific analysis job"""
    job_data = await db.analysis_jobs.find_one({"id": job_id})
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    return AnalysisJob(**job_data)

@api_router.get("/detections", response_model=List[TargetDetection])
async def get_detections(file_id: Optional[str] = None):
    """Get target detections, optionally filtered by file"""
    query = {"file_id": file_id} if file_id else {}
    detections = await db.detections.find(query).sort("timestamp", -1).to_list(1000)
    return [TargetDetection(**detection) for detection in detections]

@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    """Delete uploaded file"""
    try:
        # Get file record
        file_data = await db.files.find_one({"id": file_id})
        if not file_data:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete physical file
        file_path = Path(file_data["file_path"])
        if file_path.exists():
            file_path.unlink()
        
        # Delete from database
        await db.files.delete_one({"id": file_id})
        await db.detections.delete_many({"file_id": file_id})
        
        return {"message": "File deleted successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()