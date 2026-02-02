# Common Issues and Solutions

## Quick Answer
Most issues are solved by checking Settings for missing models, verifying file formats, or adjusting resource settings. Below are the most common problems and their solutions.

## Issues and Solutions

### Model not loading
**Symptoms**: Transcription doesn't start, chat doesn't respond
**Solution**:
1. Go to **Settings > AI/LLM** (for chat) or **Settings > Transcription** (for transcription)
2. Check if models are downloaded
3. Click download button next to a model
4. Wait for download to complete

### Transcription failed
**Possible causes and solutions**:
- **Unsupported format**: Convert to MP3 or WAV
- **Corrupted file**: Try a different file
- **Out of memory**: Use a smaller model (tiny or base)
- **GPU error**: Switch to CPU in Settings > Transcription

### Transcription is very slow
**Solutions**:
- Use a smaller model (tiny or base)
- Enable GPU in Settings > Transcription
- Close other applications to free memory
- Reduce batch size if getting memory errors

### No speakers detected (all text shows same speaker)
**Solution**: Enable diarization in **Settings > Transcription**. Note: requires a HuggingFace token.

### Live transcription not working
**Check**:
- Browser microphone permission
- System audio input settings
- Network connection (for WebSocket)
- Click Disconnect then Connect again

### OCR not extracting text from documents
**Solution**: Go to **Settings > OCR** and download OCR models.

### Can't connect to cloud storage
**Solutions**:
- Re-authenticate in Settings > Storage
- Check internet connection
- Verify OAuth credentials haven't expired

### Chat assistant not responding
**Check**:
- Model downloaded in Settings > AI/LLM
- Green connection status in sidebar
- Try refreshing the page

### Export not working
**Check**:
- Transcription is complete (not still processing)
- Sufficient disk space
- Try a different export format

## Related
- Error Messages
- Settings Configuration
