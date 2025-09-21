import React, { useState, useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Progress } from "./components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Upload, Eye, Radar, Zap, Activity, Target, BarChart3, Camera } from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Components
const FileUpload = ({ onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = async (files) => {
    const fileArray = Array.from(files);
    setUploading(true);

    try {
      for (const file of fileArray) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_type', getFileType(file.name));
        formData.append('metadata', JSON.stringify({
          size: file.size,
          lastModified: file.lastModified
        }));

        const response = await axios.post(`${API}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        toast.success(`File caricato: ${file.name}`);
      }
      
      onUploadSuccess();
    } catch (error) {
      toast.error(`Errore upload: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const getFileType = (filename) => {
    const ext = filename.toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'png', 'bmp'].includes(ext)) return 'RGB';
    if (['tif', 'tiff'].includes(ext)) return 'Thermal';
    if (['raw', 'bin'].includes(ext)) return 'Radar';
    return 'Other';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
        dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
      }`}
      onDragEnter={() => setDragActive(true)}
      onDragLeave={() => setDragActive(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-semibold mb-2">Carica Dati Multispettrali</h3>
      <p className="text-gray-600 mb-4">
        Trascina i file qui o clicca per selezionare
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Supportati: RGB, Termici, Radar, Altri sensori
      </p>
      <input
        type="file"
        multiple
        accept="image/*,.tif,.tiff,.raw,.bin"
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
        id="file-upload"
      />
      <Button
        asChild
        disabled={uploading}
        className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
      >
        <label htmlFor="file-upload">
          {uploading ? 'Caricamento...' : 'Seleziona File'}
        </label>
      </Button>
    </div>
  );
};

const AnalysisResults = ({ job }) => {
  if (!job || !job.results) return null;

  const getTargetIcon = (type) => {
    switch (type.toLowerCase()) {
      case 'vehicle': return '🚗';
      case 'person': case 'people': return '👤';
      case 'building': case 'structure': return '🏢';
      case 'aircraft': return '✈️';
      default: return '🎯';
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'bg-green-500';
    if (confidence >= 0.6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Risultati Rilevamento</h3>
      <div className="grid gap-4">
        {job.results.map((detection, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{getTargetIcon(detection.target_type)}</span>
                <div>
                  <h4 className="font-medium capitalize">{detection.target_type}</h4>
                  <p className="text-sm text-gray-600">
                    Posizione: ({Math.round(detection.bounding_box.x * 100)}%, {Math.round(detection.bounding_box.y * 100)}%)
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${getConfidenceColor(detection.confidence)}`}></div>
                <span className="font-medium">{Math.round(detection.confidence * 100)}%</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [files, setFiles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);

  const loadData = async () => {
    try {
      const [filesRes, jobsRes, detectionsRes] = await Promise.all([
        axios.get(`${API}/files`),
        axios.get(`${API}/jobs`),
        axios.get(`${API}/detections`)
      ]);
      
      setFiles(filesRes.data);
      setJobs(jobsRes.data);
      setDetections(detectionsRes.data);
    } catch (error) {
      toast.error('Errore caricamento dati');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const startAnalysis = async (fileIds, analysisType = 'single') => {
    try {
      const response = await axios.post(`${API}/analyze`, {
        file_ids: fileIds,
        analysis_type: analysisType
      });
      
      toast.success('Analisi avviata');
      setSelectedJob(response.data);
      loadData();
    } catch (error) {
      toast.error('Errore avvio analisi');
    }
  };

  const deleteFile = async (fileId) => {
    try {
      await axios.delete(`${API}/files/${fileId}`);
      toast.success('File eliminato');
      loadData();
    } catch (error) {
      toast.error('Errore eliminazione file');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>Caricamento dashboard...</p>
        </div>
      </div>
    );
  }

  const completedJobs = jobs.filter(job => job.status === 'completed');
  const totalDetections = detections.length;
  const avgConfidence = detections.length > 0 
    ? detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length 
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">DeepTrack AI</h1>
              <p className="text-gray-600">Target Recognition & Tracking</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Camera className="h-8 w-8 text-blue-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">File Caricati</p>
                  <p className="text-2xl font-bold text-gray-900">{files.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Activity className="h-8 w-8 text-green-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Analisi Completate</p>
                  <p className="text-2xl font-bold text-gray-900">{completedJobs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Target className="h-8 w-8 text-purple-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Target Rilevati</p>
                  <p className="text-2xl font-bold text-gray-900">{totalDetections}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <BarChart3 className="h-8 w-8 text-orange-500" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Confidenza Media</p>
                  <p className="text-2xl font-bold text-gray-900">{Math.round(avgConfidence * 100)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="files">File</TabsTrigger>
            <TabsTrigger value="analysis">Analisi</TabsTrigger>
            <TabsTrigger value="results">Risultati</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle>Carica Dati Multispettrali</CardTitle>
                <CardDescription>
                  Carica immagini e dati da sensori RGB, termici, radar e altri per l'analisi AI
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileUpload onUploadSuccess={loadData} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="files">
            <Card>
              <CardHeader>
                <CardTitle>File Caricati</CardTitle>
                <CardDescription>Gestisci i tuoi file multispettrali</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {files.map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <div>
                          <h4 className="font-medium">{file.filename}</h4>
                          <p className="text-sm text-gray-600">
                            Tipo: {file.file_type} • Caricato: {new Date(file.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          onClick={() => startAnalysis([file.id])}
                          className="bg-gradient-to-r from-green-500 to-emerald-600"
                        >
                          <Zap className="h-4 w-4 mr-1" />
                          Analizza
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteFile(file.id)}
                        >
                          Elimina
                        </Button>
                      </div>
                    </div>
                  ))}
                  {files.length === 0 && (
                    <p className="text-center text-gray-500 py-8">
                      Nessun file caricato. Inizia caricando i tuoi dati multispettrali.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analysis">
            <Card>
              <CardHeader>
                <CardTitle>Lavori di Analisi</CardTitle>
                <CardDescription>Monitora i tuoi processi di analisi AI</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <div key={job.id} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium">Analisi {job.analysis_type}</h4>
                          <p className="text-sm text-gray-600">
                            {job.file_ids.length} file • {new Date(job.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant={
                          job.status === 'completed' ? 'default' :
                          job.status === 'processing' ? 'secondary' :
                          job.status === 'failed' ? 'destructive' : 'outline'
                        }>
                          {job.status}
                        </Badge>
                      </div>
                      {job.status === 'processing' && (
                        <Progress value={50} className="mb-2" />
                      )}
                      {job.status === 'completed' && job.results && (
                        <div className="mt-3">
                          <p className="text-sm text-green-600 font-medium">
                            ✓ {job.results.length} target rilevati
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => setSelectedJob(job)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Visualizza Risultati
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {jobs.length === 0 && (
                    <p className="text-center text-gray-500 py-8">
                      Nessuna analisi in corso. Avvia un'analisi dalla sezione File.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            <Card>
              <CardHeader>
                <CardTitle>Risultati Dettagliati</CardTitle>
                <CardDescription>Visualizza i risultati del riconoscimento target</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedJob ? (
                  <AnalysisResults job={selectedJob} />
                ) : (
                  <p className="text-center text-gray-500 py-8">
                    Seleziona un'analisi completata per visualizzare i risultati.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

const Home = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-600/20 to-blue-600/20"></div>
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1631259352402-c6b7f0625df3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwxfHxtdWx0aXNwZWN0cmFsfGVufDB8fHx8MTc1ODQ3NjI0MXww&ixlib=rb-4.1.0&q=85')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        ></div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <div className="mb-8 flex justify-center">
              <div className="w-20 h-20 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-xl">
                <Target className="h-10 w-10 text-white" />
              </div>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight">
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                DeepTrack
              </span>{" "}
              <span className="text-white">AI</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
              Sistema avanzato di <span className="text-cyan-400 font-semibold">riconoscimento</span> e{" "}
              <span className="text-blue-400 font-semibold">tracking</span> con deep learning su dati multispettrali
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium px-8 py-4 text-lg shadow-2xl"
                onClick={() => window.location.href = '/dashboard'}
              >
                <Zap className="mr-2 h-5 w-5" />
                Inizia Analisi
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                className="border-2 border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-slate-900 font-medium px-8 py-4 text-lg"
              >
                <Eye className="mr-2 h-5 w-5" />
                Demo Live
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-slate-800/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">
              Tecnologie <span className="text-cyan-400">Avanzate</span>
            </h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Utilizziamo i più recenti algoritmi di deep learning per analisi multispettrali precise
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: <Radar className="h-12 w-12" />,
                title: "Analisi Multispettrale",
                description: "Processamento avanzato di dati RGB, termici, radar e altri sensori per detection completa",
                image: "https://images.unsplash.com/photo-1649297153348-061091e9aaa2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwyfHxtdWx0aXNwZWN0cmFsfGVufDB8fHx8MTc1ODQ3NjI0MXww&ixlib=rb-4.1.0&q=85"
              },
              {
                icon: <Target className="h-12 w-12" />,
                title: "Recognition Intelligente",
                description: "AI avanzata per riconoscimento accurato di veicoli, persone, strutture e oggetti",
                image: "https://images.unsplash.com/photo-1501621667575-af81f1f0bacc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwyfHxjb21wdXRlciUyMHZpc2lvbnxlbnwwfHx8fDE3NTg0NzYyNTB8MA&ixlib=rb-4.1.0&q=85"
              },
              {
                icon: <Activity className="h-12 w-12" />,
                title: "Tracking Real-time",
                description: "Monitoraggio continuo e tracking avanzato per analisi dinamiche e sequenziali",
                image: "https://images.unsplash.com/photo-1504639725590-34d0984388bd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwzfHxjb21wdXRlciUyMHZpc2lvbnxlbnwwfHx8fDE3NTg0NzYyNTB8MA&ixlib=rb-4.1.0&q=85"
              }
            ].map((feature, index) => (
              <Card key={index} className="bg-slate-800/80 border-slate-700 backdrop-blur-sm hover:bg-slate-700/80 transition-all duration-300 group">
                <CardContent className="p-8">
                  <div 
                    className="w-full h-48 rounded-lg mb-6 bg-cover bg-center relative overflow-hidden"
                    style={{ backgroundImage: `url('${feature.image}')` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent"></div>
                    <div className="absolute bottom-4 left-4 text-cyan-400 group-hover:scale-110 transition-transform duration-300">
                      {feature.icon}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                  <p className="text-gray-300 leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-r from-cyan-600 to-blue-600">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-white mb-6">
            Pronto per l'Analisi Avanzata?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Inizia subito con DeepTrack AI e scopri le potenzialità del deep learning sui tuoi dati multispettrali
          </p>
          <Button 
            size="lg" 
            className="bg-white text-blue-600 hover:bg-blue-50 font-bold px-12 py-4 text-lg shadow-2xl"
            onClick={() => window.location.href = '/dashboard'}
          >
            <Target className="mr-2 h-5 w-5" />
            Accedi alla Dashboard
          </Button>
        </div>
      </section>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;