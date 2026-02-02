# Settings Configuration

## Quick Answer
Access all app settings from the Settings page in the sidebar. Tabs include General, Transcription, AI/LLM, OCR, Storage, Backup, and System Info.

## Settings Tabs

### General
- **Theme**: Light, dark, or system preference
- **Default language**: For new transcriptions
- **Playback speed**: Default audio playback rate (0.5x - 2x)
- **Auto-transcribe**: Automatically transcribe new uploads

### Transcription
- **Model**: Whisper model size (tiny to large)
- **Device**: CPU or GPU (CUDA, MPS)
- **Compute type**: Precision level (float32, float16, int8)
- **Batch size**: Processing chunks (higher = faster, more memory)
- **Diarization**: Enable speaker identification
- **HuggingFace token**: Required for some models and diarization

### AI/LLM
- **Download models**: Get chat AI models (Mistral, Llama, etc.)
- **Active model**: Select which model to use for chat
- **GPU layers**: How much to offload to GPU

### OCR
- **Download models**: Get OCR models for document text extraction
- **Active model**: Select OCR model to use

### Storage
- **Storage locations**: Add local, network, or cloud storage
- **Cloud providers**: Google Drive, OneDrive, Dropbox, S3
- **Default location**: Where new files are stored
- **OAuth credentials**: Configure cloud authentication

### Backup/Archive
- **Export**: Create full database backup
- **Import**: Restore from backup file
- **Encryption**: Optional backup encryption

### System Info
- **Hardware**: CPU, RAM, GPU details
- **Services**: Status of running services
- **Version**: App and model versions

## UI Location
- **Page**: Settings (bottom of sidebar)
- **Tabs**: Horizontal tab bar at top of Settings page

## Tips
- Changes to transcription settings apply to new jobs only
- Download models before first use
- GPU acceleration requires compatible hardware
- Back up regularly to protect your data

## Related
- Transcription Settings
- AI Chat
