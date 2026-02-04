# Bundle Whisper Models for Offline Transcription

**Date:** 2025-02-04
**Status:** Approved

## Problem

Users encounter "cannot find appropriate snapshot folder" errors when using live transcription on a fresh install. The mlx_whisper library tries to download models from HuggingFace Hub, which fails without internet or on first use.

The app promises offline operation but requires internet for first-time model downloads.

## Solution

Bundle whisper-base (~144 MB) and pyannote diarization models (~100 MB) with the app, and provide UI for users to download additional whisper models (tiny, small, medium, large-v3).

## Design

### 1. Build & Bundle Configuration

**New build script:** `scripts/prepare-whisper-models.sh`
- Downloads `mlx-community/whisper-base-mlx` from HuggingFace
- Downloads `pyannote/segmentation-3.0` and `pyannote/wespeaker-voxceleb-resnet34-LM`
- Places them in `build/resources/whisper-models/` with HuggingFace cache directory structure

**Update `apps/electron/package.json`** extraResources:
```json
{
  "from": "../../build/resources/whisper-models",
  "to": "whisper-models",
  "filter": ["**/*"]
}
```

**First-launch bootstrap** (electron main process):
- Check if `~/.cache/huggingface/hub/models--mlx-community--whisper-base-mlx` exists
- If not, copy from `resources/whisper-models/` to the cache location
- Same for pyannote models in `~/.cache/torch/pyannote/`

### 2. Backend - Whisper Model Catalog & API

**New file:** `packages/backend/core/whisper_catalog.py`

```python
WHISPER_MODELS = [
    {
        "id": "whisper-tiny",
        "label": "Whisper Tiny",
        "description": "Fastest, lowest accuracy. Good for quick drafts.",
        "repo": "mlx-community/whisper-tiny-mlx",
        "size_bytes": 74_418_540,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-base",
        "label": "Whisper Base",
        "description": "Good balance of speed and accuracy. Bundled with app.",
        "repo": "mlx-community/whisper-base-mlx",
        "size_bytes": 143_724_204,
        "is_default": True,
        "bundled": True,
    },
    {
        "id": "whisper-small",
        "label": "Whisper Small",
        "description": "Better accuracy, slower processing.",
        "repo": "mlx-community/whisper-small-mlx",
        "size_bytes": 481_307_592,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-medium",
        "label": "Whisper Medium",
        "description": "High accuracy for difficult audio.",
        "repo": "mlx-community/whisper-medium-mlx",
        "size_bytes": 1_524_924_912,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-large-v3",
        "label": "Whisper Large v3",
        "description": "Best accuracy. Requires 8GB+ RAM.",
        "repo": "mlx-community/whisper-large-v3-mlx",
        "size_bytes": 3_247_898_936,
        "is_default": False,
        "bundled": False,
    },
]
```

**New file:** `packages/backend/api/routes/whisper.py`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/whisper/models` | GET | List all whisper models with status |
| `/api/whisper/models/{model_id}/download` | POST | Download model via SSE |
| `/api/whisper/models/{model_id}` | DELETE | Delete a downloaded model |
| `/api/whisper/models/{model_id}/activate` | POST | Set as active transcription model |

**Status detection:**
- Check HuggingFace cache (`~/.cache/huggingface/hub/models--mlx-community--{repo}`)
- Look for `weights.npz` file to confirm complete download
- Track active model via existing transcription config

### 3. Frontend - Settings UI

Add section in `SettingsPage.tsx` under Transcription settings:

```
┌─────────────────────────────────────────────────────────┐
│ Transcription Models                                     │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Whisper Base                          ✓ Active      │ │
│ │ Good balance of speed and accuracy.   Bundled       │ │
│ │ 144 MB                                              │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Whisper Small                         [Download]    │ │
│ │ Better accuracy, slower.                            │ │
│ │ 459 MB                                              │ │
│ └─────────────────────────────────────────────────────┘ │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

**Visual patterns (matching existing AI/OCR sections):**
- "Bundled" badge (blue) for whisper-base
- "Active" badge (green) with checkmark for selected model
- Download button → Progress bar → Activate/Delete buttons

**API client additions in `api.ts`:**
- `api.whisper.getModels()`
- `api.whisper.downloadModel(modelId, onEvent)`
- `api.whisper.deleteModel(modelId)`
- `api.whisper.activateModel(modelId)`

### 4. First-Launch Bootstrap & Integration

**Electron bootstrap (`apps/electron/src/main/bootstrap.ts`):**

On app startup:
1. Check if bundled models exist in HuggingFace cache
2. If missing, copy from `process.resourcesPath/whisper-models/`
3. Log success/failure

**Integration with existing config:**
- Keep using `transcription_model` setting
- Default to `base` (bundled)
- Validate model is downloaded before transcription
- Fall back to `base` with warning if selected model missing

**Better error message in `mlx_whisper.py`:**
```
"Model 'whisper-small' is not downloaded. Please download it from Settings → Transcription Models."
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `scripts/prepare-whisper-models.sh` | Create |
| `apps/electron/package.json` | Modify |
| `apps/electron/src/main/bootstrap.ts` | Create |
| `apps/electron/src/main/index.ts` | Modify |
| `packages/backend/core/whisper_catalog.py` | Create |
| `packages/backend/api/routes/whisper.py` | Create |
| `packages/backend/api/main.py` | Modify |
| `packages/backend/adapters/transcription/mlx_whisper.py` | Modify |
| `packages/frontend/src/lib/api.ts` | Modify |
| `packages/frontend/src/pages/settings/SettingsPage.tsx` | Modify |

## Build Impact

- DMG size increase: ~250 MB
- No runtime performance impact
- Enables true offline operation out of the box
