# Transcription Settings

## Quick Answer
Configure transcription quality, speed, and speaker detection in Settings > Transcription. Larger models are more accurate but slower; GPU acceleration significantly improves speed.

## Step-by-Step

1. Navigate to **Settings** in the sidebar
2. Click the **Transcription** tab
3. Configure options:
   - **Model**: Choose size (tiny, base, small, medium, large)
   - **Device**: CPU or GPU
   - **Language**: Source audio language
   - **Diarization**: Enable to identify speakers
4. Changes apply to new transcriptions

## Settings Explained

### Model Size
| Model | Speed | Accuracy | Memory |
|-------|-------|----------|--------|
| Tiny | Fastest | Basic | ~1GB |
| Base | Fast | Good | ~1GB |
| Small | Medium | Better | ~2GB |
| Medium | Slow | High | ~5GB |
| Large | Slowest | Highest | ~10GB |

### Device Options
- **CPU**: Works on all computers, slower
- **CUDA**: Nvidia GPU acceleration, much faster
- **MPS**: Apple Silicon GPU acceleration

### Diarization
When enabled, the system identifies different speakers and labels them (SPEAKER_00, SPEAKER_01, etc.). You can rename these later. Requires a HuggingFace token.

## UI Location
- **Page**: Settings
- **Tab**: Transcription

## Tips
- Start with "base" model for good balance of speed and accuracy
- Use GPU if available - it's 5-10x faster
- Enable diarization for interviews and meetings
- The "large" model needs significant RAM and VRAM

## Related
- Uploading Files
- Editing Transcripts
