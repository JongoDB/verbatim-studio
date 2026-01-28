# Design: llama.cpp Integration (Local LLM for Basic Tier)

## Summary

Prove out local LLM integration by wiring up the existing `LlamaCppAIService` adapter with a real GGUF model (Granite 3.3 2B) and building frontend UI for transcript summarization and model management.

## Decisions

- **Python bindings** (`llama-cpp-python`) over sidecar `llama-server` — simpler for basic tier with one pre-loaded model. Enterprise tier uses Ollama for multi-model serving.
- **First feature**: Transcript summarization (not chat). Self-contained, no conversation state.
- **Default model**: Granite 3.3 2B Instruct Q4_K_M (1.55 GB) from `bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF`.

## Model Tier Strategy

### Basic Tier
- **One model at a time** — user picks from a curated catalog, downloads one, can swap later.
- **Curated catalog** — a handful of models chosen for different use cases:
  - Granite 3.3 2B (default) — balanced summarization and analysis
  - Additional models TBD for chat, code analysis, etc.
- Download button per model with progress bar. Downloading a new model replaces the active one (or keeps both on disk but only loads one).

### Enterprise Tier (Future)
- **Multiple concurrent models** via Ollama
- **Open model search** — browse/search HuggingFace for any GGUF model
- **Model management UI** — install, remove, set defaults per task type

## Architecture

### What Already Exists
- `IAIService` interface (`core/interfaces/ai.py`)
- `LlamaCppAIService` adapter (`adapters/ai/llama_cpp.py`)
- Factory pattern (`core/factory.py`) — basic tier creates `LlamaCppAIService`
- API routes (`api/routes/ai.py`): `/status`, `/chat`, `/chat/stream`, `/transcripts/{id}/summarize`, `/transcripts/{id}/analyze`, `/transcripts/{id}/ask`
- Config: `AI_MODEL_PATH`, `AI_N_CTX`, `AI_N_GPU_LAYERS`

### What Changes

#### 1. Fix LlamaCppAIService Adapter
- Replace manual `_format_messages()` with `create_chat_completion()` — reads chat template from GGUF metadata, works with any model.
- Wrap synchronous inference in `asyncio.to_thread()` to avoid blocking the FastAPI event loop.
- Delete the `_format_messages()` method entirely.

#### 2. Model Download Endpoint
- `POST /api/ai/models/download` — download a model from HuggingFace
- `GET /api/ai/models` — list available/downloaded models from the curated catalog
- Uses `huggingface-hub` for resumable downloads with progress
- Downloads to `~/Library/Application Support/Verbatim Studio/models/`
- Auto-configures `AI_MODEL_PATH` after download

#### 3. Model Catalog
Hardcoded curated list in the backend:

```python
MODEL_CATALOG = {
    "granite-3.3-2b": {
        "repo": "bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf",
        "size_bytes": 1_550_000_000,
        "label": "Granite 3.3 2B",
        "description": "IBM's compact instruct model. Good for summarization and analysis.",
        "default": True,
    },
    # Future entries for chat-optimized models, etc.
}
```

#### 4. Frontend — Summarize Button
- Button in transcript detail header, calls `POST /api/ai/transcripts/{id}/summarize`
- Disabled when AI unavailable (no model downloaded)
- Summary panel: summary text, key points, action items, topics

#### 5. Frontend — Settings Page AI Section
- "AI / LLM" section showing model status
- Curated model cards with download buttons and progress bars
- Active model indicator
- Model info when loaded (name, size, context window)

#### 6. Frontend API Client
- `ai.getStatus()` → `GET /api/ai/status`
- `ai.summarize(transcriptId)` → `POST /api/ai/transcripts/{id}/summarize`
- `ai.downloadModel(modelId)` → `POST /api/ai/models/download`
- `ai.listModels()` → `GET /api/ai/models`

## Dependencies

- `llama-cpp-python>=0.2.0` — compiled with Metal: `CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python`
- `huggingface-hub>=0.20.0` — model downloads

## Chat Template

Granite 3.3 uses `<|start_of_role|>system<|end_of_role|>...<|end_of_text|>` format. The `create_chat_completion()` API handles this automatically from GGUF metadata — no manual template code needed.

## Files Changed

| File | Change |
|------|--------|
| `adapters/ai/llama_cpp.py` | Fix: use `create_chat_completion()`, add `asyncio.to_thread()` |
| `api/routes/ai.py` | Add model download and list endpoints |
| `core/config.py` | Add model catalog, auto-discovery |
| `pyproject.toml` | Add `huggingface-hub` dependency |
| `frontend/src/lib/api.ts` | Add AI API client methods |
| `frontend/src/pages/recordings/TranscriptDetailPage.tsx` (or equivalent) | Add Summarize button and summary panel |
| `frontend/src/pages/settings/` | Add AI/LLM section with model management |
