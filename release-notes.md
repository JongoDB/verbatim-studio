## What's New in v0.39.1

### 🐛 Bug Fixes
- Fixed Windows installer failing to build due to bundle size exceeding NSIS limits
- Fixed GPU/CUDA not being used for AI transcription on Windows (was falling back to CPU)
- Fixed uploads, recordings, live transcription, and video processing failing on Windows
- Fixed "Failed to start backend" error on first launch due to slow initial startup
- Fixed OCR model dependencies installing an incompatible version on Windows
- Fixed OCR appearing ready before all required packages were installed

### 🔧 Improvements
- Reduced Windows installer size significantly (~3GB smaller) while keeping GPU transcription
- GPU transcription now works out of the box on Windows with NVIDIA GPUs
- Windows feature parity with macOS for bundled functionality (transcription, diarization, semantic search, document processing)
- Speaker diarization libraries now bundled on Windows (models still require HuggingFace token)
- Semantic search embedding model bundled for offline use
- Increased backend startup timeout to handle first-launch model loading on Windows
- Increased frontend connection retry window with smarter backoff for slow startups

### 📝 Notes
- GPU acceleration requires an NVIDIA GPU with CUDA support
- Speaker diarization requires a HuggingFace token and model download on first use
- First launch may take 30-60 seconds while models are prepared
