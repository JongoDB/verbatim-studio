# Error Messages Explained

## Quick Answer
Error messages appear when something goes wrong. This guide explains common errors and how to resolve them.

## Error Reference

### "Model not found"
**Meaning**: The required AI model isn't downloaded.
**Solution**: Go to Settings and download the model (Transcription, AI/LLM, or OCR depending on the feature).

### "Out of memory" / "CUDA out of memory"
**Meaning**: Not enough RAM or GPU memory for the operation.
**Solutions**:
- Use a smaller model
- Switch to CPU processing
- Close other applications
- Reduce batch size

### "Unsupported file format"
**Meaning**: The uploaded file type isn't recognized.
**Solution**: Convert to a supported format (MP3, WAV, M4A for audio; MP4, MOV for video).

### "Transcription failed"
**Meaning**: The transcription job couldn't complete.
**Solutions**:
- Check the file isn't corrupted
- Try a smaller model
- Check available disk space
- View job details for specific error

### "Connection failed" / "WebSocket error"
**Meaning**: Can't connect to the backend service.
**Solutions**:
- Check if the service is running
- Refresh the page
- Check network connectivity

### "Authentication required" / "OAuth expired"
**Meaning**: Cloud storage credentials need refresh.
**Solution**: Go to Settings > Storage and re-authenticate with the cloud provider.

### "Storage location unreachable"
**Meaning**: Can't access the configured storage.
**Solutions**:
- Check network connection
- Verify path exists (local storage)
- Re-authenticate (cloud storage)

### "Rate limited"
**Meaning**: Too many requests to an external service.
**Solution**: Wait a few minutes and try again.

### "File too large"
**Meaning**: The uploaded file exceeds size limits.
**Solution**: Split into smaller files or compress the file.

### "Diarization failed"
**Meaning**: Speaker identification couldn't complete.
**Solutions**:
- Verify HuggingFace token in Settings > Transcription
- Check internet connection (required for some diarization models)

## UI Location
- **Error toasts**: Appear in corner of screen
- **Job errors**: Visible in job status or recording card
- **Detailed logs**: Check browser console for technical details

## Related
- Common Issues
- Settings Configuration
