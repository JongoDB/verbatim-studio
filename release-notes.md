## What's New in v0.39.1

### 🐛 Bug Fixes
- Fixed uploads, recordings, live transcription, and video processing failing on Windows
- Fixed GPU/CUDA not being used for AI transcription on Windows (was falling back to CPU)
- Fixed "Failed to start backend" error on first launch due to slow initial startup
- Fixed OCR model dependencies installing an incompatible version on Windows
- Fixed OCR appearing ready before all required packages were installed

### 🔧 Improvements
- Increased backend startup timeout to handle first-launch model loading on Windows
- Increased frontend connection retry window with smarter backoff for slow startups
- Added CI verification step to catch broken PyTorch imports after build optimization

### 📝 Notes
- GPU acceleration requires an NVIDIA GPU with CUDA support
- First launch may take 30-60 seconds while models are prepared
