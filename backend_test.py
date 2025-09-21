import requests
import sys
import json
import time
from datetime import datetime
from pathlib import Path
import tempfile
from PIL import Image
import io

class DeepTrackAPITester:
    def __init__(self, base_url="https://deeptrack.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_files = []
        self.created_jobs = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED {details}")
        else:
            print(f"❌ {name} - FAILED {details}")
        return success

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}" if endpoint else self.api_url
        headers = {}
        
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                if files:
                    response = requests.post(url, data=data, files=files, timeout=60)
                else:
                    headers['Content-Type'] = 'application/json'
                    response = requests.post(url, json=data, headers=headers, timeout=60)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            
            if success:
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and 'message' in response_data:
                        details += f" | Message: {response_data['message']}"
                    elif isinstance(response_data, list):
                        details += f" | Items: {len(response_data)}"
                    elif isinstance(response_data, dict) and 'id' in response_data:
                        details += f" | ID: {response_data['id'][:8]}..."
                except:
                    details += " | Response: Non-JSON"
            else:
                try:
                    error_data = response.json()
                    details += f" | Error: {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f" | Raw Error: {response.text[:100]}"

            self.log_test(name, success, details)
            return success, response.json() if success and response.text else {}

        except requests.exceptions.Timeout:
            self.log_test(name, False, "Request timeout")
            return False, {}
        except requests.exceptions.ConnectionError:
            self.log_test(name, False, "Connection error")
            return False, {}
        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def create_test_image(self, filename="test_image.jpg"):
        """Create a test image file"""
        # Create a simple test image
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_bytes.seek(0)
        return img_bytes

    def test_root_endpoint(self):
        """Test root API endpoint"""
        return self.run_test("Root API Endpoint", "GET", "", 200)

    def test_upload_file(self):
        """Test file upload functionality"""
        # Create test image
        test_image = self.create_test_image()
        
        files = {
            'file': ('test_multispectral.jpg', test_image, 'image/jpeg')
        }
        data = {
            'file_type': 'RGB',
            'metadata': json.dumps({
                'test': True,
                'sensor': 'RGB_Camera',
                'resolution': '100x100'
            })
        }
        
        success, response = self.run_test("File Upload", "POST", "upload", 200, data=data, files=files)
        
        if success and 'id' in response:
            self.uploaded_files.append(response['id'])
            print(f"   📁 Uploaded file ID: {response['id']}")
            
        return success, response

    def test_get_files(self):
        """Test getting all files"""
        success, response = self.run_test("Get All Files", "GET", "files", 200)
        
        if success and isinstance(response, list):
            print(f"   📊 Total files in system: {len(response)}")
            for file_info in response[:3]:  # Show first 3 files
                print(f"   📄 File: {file_info.get('filename', 'Unknown')} ({file_info.get('file_type', 'Unknown')})")
                
        return success

    def test_create_analysis(self):
        """Test creating analysis job"""
        if not self.uploaded_files:
            print("   ⚠️  No uploaded files available for analysis")
            return False
            
        data = {
            'file_ids': [self.uploaded_files[0]],
            'analysis_type': 'single'
        }
        
        success, response = self.run_test("Create Analysis Job", "POST", "analyze", 200, data=data)
        
        if success and 'id' in response:
            self.created_jobs.append(response['id'])
            print(f"   🔬 Created job ID: {response['id']}")
            print(f"   📊 Job status: {response.get('status', 'Unknown')}")
            
        return success, response

    def test_get_jobs(self):
        """Test getting all analysis jobs"""
        success, response = self.run_test("Get Analysis Jobs", "GET", "jobs", 200)
        
        if success and isinstance(response, list):
            print(f"   📊 Total jobs in system: {len(response)}")
            for job in response[:3]:  # Show first 3 jobs
                print(f"   🔬 Job: {job.get('id', 'Unknown')[:8]}... Status: {job.get('status', 'Unknown')}")
                
        return success

    def test_get_specific_job(self):
        """Test getting specific job by ID"""
        if not self.created_jobs:
            print("   ⚠️  No created jobs available")
            return False
            
        job_id = self.created_jobs[0]
        success, response = self.run_test("Get Specific Job", "GET", f"jobs/{job_id}", 200)
        
        if success:
            print(f"   📊 Job status: {response.get('status', 'Unknown')}")
            print(f"   📁 File IDs: {response.get('file_ids', [])}")
            if response.get('results'):
                print(f"   🎯 Results: {len(response['results'])} detections")
                
        return success

    def test_get_detections(self):
        """Test getting target detections"""
        success, response = self.run_test("Get All Detections", "GET", "detections", 200)
        
        if success and isinstance(response, list):
            print(f"   📊 Total detections: {len(response)}")
            for detection in response[:3]:  # Show first 3 detections
                print(f"   🎯 Detection: {detection.get('target_type', 'Unknown')} "
                      f"(Confidence: {detection.get('confidence', 0):.2f})")
                
        return success

    def test_get_detections_by_file(self):
        """Test getting detections filtered by file"""
        if not self.uploaded_files:
            print("   ⚠️  No uploaded files available")
            return False
            
        file_id = self.uploaded_files[0]
        success, response = self.run_test("Get Detections by File", "GET", f"detections?file_id={file_id}", 200)
        
        if success and isinstance(response, list):
            print(f"   📊 Detections for file {file_id[:8]}...: {len(response)}")
                
        return success

    def wait_for_job_completion(self, job_id, max_wait=60):
        """Wait for analysis job to complete"""
        print(f"\n⏳ Waiting for job {job_id[:8]}... to complete (max {max_wait}s)")
        
        start_time = time.time()
        while time.time() - start_time < max_wait:
            try:
                response = requests.get(f"{self.api_url}/jobs/{job_id}", timeout=10)
                if response.status_code == 200:
                    job_data = response.json()
                    status = job_data.get('status', 'unknown')
                    print(f"   Status: {status}")
                    
                    if status == 'completed':
                        results = job_data.get('results', [])
                        print(f"   ✅ Job completed with {len(results)} detections")
                        return True
                    elif status == 'failed':
                        print(f"   ❌ Job failed")
                        return False
                        
                time.sleep(5)  # Wait 5 seconds before checking again
                
            except Exception as e:
                print(f"   ⚠️  Error checking job status: {str(e)}")
                
        print(f"   ⏰ Job did not complete within {max_wait} seconds")
        return False

    def test_delete_file(self):
        """Test file deletion"""
        if not self.uploaded_files:
            print("   ⚠️  No uploaded files to delete")
            return False
            
        file_id = self.uploaded_files[-1]  # Delete the last uploaded file
        success, response = self.run_test("Delete File", "DELETE", f"files/{file_id}", 200)
        
        if success:
            self.uploaded_files.remove(file_id)
            print(f"   🗑️  Deleted file: {file_id}")
            
        return success

def main():
    print("🚀 Starting DeepTrack AI Backend API Tests")
    print("=" * 60)
    
    tester = DeepTrackAPITester()
    
    # Test sequence
    tests = [
        ("Root Endpoint", tester.test_root_endpoint),
        ("File Upload", tester.test_upload_file),
        ("Get Files", tester.test_get_files),
        ("Create Analysis", tester.test_create_analysis),
        ("Get Jobs", tester.test_get_jobs),
        ("Get Specific Job", tester.test_get_specific_job),
        ("Get Detections", tester.test_get_detections),
        ("Get Detections by File", tester.test_get_detections_by_file),
        ("Delete File", tester.test_delete_file),
    ]
    
    # Run all tests
    for test_name, test_func in tests:
        try:
            test_func()
        except Exception as e:
            tester.log_test(test_name, False, f"Exception: {str(e)}")
        
        time.sleep(1)  # Brief pause between tests
    
    # Wait for analysis job to complete if we created one
    if tester.created_jobs:
        job_completed = tester.wait_for_job_completion(tester.created_jobs[0])
        if job_completed:
            # Re-test detections after job completion
            print("\n🔄 Re-testing detections after job completion...")
            tester.test_get_detections()
            tester.test_get_detections_by_file()
    
    # Print final results
    print("\n" + "=" * 60)
    print("📊 FINAL TEST RESULTS")
    print("=" * 60)
    print(f"✅ Tests Passed: {tester.tests_passed}")
    print(f"❌ Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"📊 Total Tests: {tester.tests_run}")
    print(f"📈 Success Rate: {(tester.tests_passed/tester.tests_run)*100:.1f}%")
    
    if tester.uploaded_files:
        print(f"📁 Files Created: {len(tester.uploaded_files)}")
    if tester.created_jobs:
        print(f"🔬 Jobs Created: {len(tester.created_jobs)}")
    
    # Return exit code
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())