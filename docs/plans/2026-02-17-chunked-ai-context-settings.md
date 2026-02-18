# Chunked AI Processing + Context Window Settings

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI features (summarize, analyze, ask, chat) work correctly on transcripts of any length via map-reduce chunking, and let users configure the context window size from the Settings UI.

**Architecture:** Add a chunked processing layer inside `LlamaCppAIService` that automatically splits long transcripts into overlapping chunks, processes each independently, then merges results. Add a persisted AI settings system (mirroring the transcription settings pattern) with a context window slider in the frontend Settings > AI tab. The model catalog gains a `max_context` field so the slider knows its upper bound.

**Tech Stack:** Python (FastAPI, llama-cpp-python), React/TypeScript, SQLite (Setting model for persistence)

---

### Task 1: Add `max_context` to Model Catalog + AI Settings Persistence

**Files:**
- Modify: `packages/backend/core/model_catalog.py`
- Create: `packages/backend/core/ai_settings.py`
- Modify: `packages/backend/api/routes/config.py`
- Modify: `packages/backend/api/routes/ai.py` (import reload on settings change)

**Step 1: Add `max_context` to model catalog**

In `packages/backend/core/model_catalog.py`, add `max_context` to the Granite entry. Granite 3.3 8B supports 128K context natively, but at Q4_K_M quantization in llama.cpp, practical limits depend on RAM. Set the catalog max to 131072 (128K) — the slider will let users choose within this range.

```python
MODEL_CATALOG: dict[str, dict] = {
    "granite-3.3-8b": {
        "repo": "bartowski/ibm-granite_granite-3.3-8b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-8b-instruct-Q4_K_M.gguf",
        "size_bytes": 4_920_000_000,
        "label": "Granite 3.3 8B",
        "description": "IBM's instruct model. Recommended for chat and analysis.",
        "default": True,
        "max_context": 131072,  # 128K native context window
    },
}
```

**Step 2: Create AI settings persistence module**

Create `packages/backend/core/ai_settings.py` following the same pattern as `transcription_settings.py` — DB-backed with env fallback:

```python
"""AI settings helper with DB persistence and fallback chain.

Fallback order: DB setting → env var → hardcoded default.
"""

import logging
from typing import Any

from sqlalchemy import select

from core.config import settings as env_settings
from persistence.database import get_session_factory
from persistence.models import Setting

logger = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {
    "context_size": 8192,
}

# Allowed context sizes: powers-of-2 friendly stops from 2K to 128K
VALID_CONTEXT_SIZES = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

# RAM estimates per context size (approximate, for UI display)
# Based on Q4_K_M 8B model: ~5GB base + ~0.5GB per 8K context
CONTEXT_RAM_ESTIMATES = {
    2048: "~5 GB",
    4096: "~5 GB",
    8192: "~5.5 GB",
    16384: "~6 GB",
    32768: "~7 GB",
    65536: "~9 GB",
    131072: "~13 GB",
}


async def get_ai_settings() -> dict[str, Any]:
    """Get effective AI settings using fallback chain: DB → env → default."""
    result = dict(DEFAULTS)

    # Layer 1: env vars override defaults
    if env_settings.AI_N_CTX != 8192:  # Non-default env value
        result["context_size"] = env_settings.AI_N_CTX

    # Layer 2: DB overrides env
    session_factory = get_session_factory()
    async with session_factory() as session:
        db_result = await session.execute(
            select(Setting).where(Setting.key.like("ai.%"))
        )
        for row in db_result.scalars():
            key = row.key.removeprefix("ai.")
            if key == "context_size":
                try:
                    result[key] = int(row.value)
                except (ValueError, TypeError):
                    pass

    return result


async def save_ai_settings(updates: dict[str, Any]) -> None:
    """Save AI settings to DB."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        for key, value in updates.items():
            db_key = f"ai.{key}"
            existing = await session.execute(
                select(Setting).where(Setting.key == db_key)
            )
            row = existing.scalar_one_or_none()
            if row:
                row.value = str(value)
            else:
                session.add(Setting(key=db_key, value=str(value)))
        await session.commit()
```

**Step 3: Add AI settings endpoints to config router**

In `packages/backend/api/routes/config.py`, add GET/PUT endpoints for AI settings:

```python
from core.ai_settings import (
    get_ai_settings,
    save_ai_settings,
    VALID_CONTEXT_SIZES,
    CONTEXT_RAM_ESTIMATES,
)
from core.model_catalog import MODEL_CATALOG


class AISettingsResponse(BaseModel):
    """AI settings with available options."""
    context_size: int
    available_context_sizes: list[int]
    max_model_context: int  # From active model's catalog entry
    ram_estimates: dict[int, str]


class AISettingsUpdate(BaseModel):
    """Partial update for AI settings."""
    context_size: int | None = None


@router.get("/ai", response_model=AISettingsResponse)
async def get_ai_config() -> AISettingsResponse:
    """Get effective AI settings and available options."""
    effective = await get_ai_settings()

    # Get max context from active model catalog entry
    from api.routes.ai import _read_active_model
    active_id = _read_active_model()
    max_ctx = 131072  # default fallback
    if active_id and active_id in MODEL_CATALOG:
        max_ctx = MODEL_CATALOG[active_id].get("max_context", 131072)

    # Filter available sizes to model's max
    available = [s for s in VALID_CONTEXT_SIZES if s <= max_ctx]

    return AISettingsResponse(
        context_size=effective["context_size"],
        available_context_sizes=available,
        max_model_context=max_ctx,
        ram_estimates=CONTEXT_RAM_ESTIMATES,
    )


@router.put("/ai", response_model=AISettingsResponse)
async def update_ai_config(body: AISettingsUpdate) -> AISettingsResponse:
    """Update AI settings. Requires model reload to take effect."""
    updates: dict[str, Any] = {}

    if body.context_size is not None:
        if body.context_size not in VALID_CONTEXT_SIZES:
            raise HTTPException(
                400,
                f"Invalid context_size: {body.context_size}. "
                f"Must be one of: {VALID_CONTEXT_SIZES}",
            )
        updates["context_size"] = body.context_size

    if not updates:
        raise HTTPException(400, "No valid fields provided")

    await save_ai_settings(updates)

    # Update runtime settings and invalidate cached model
    effective = await get_ai_settings()
    settings.AI_N_CTX = effective["context_size"]

    # Force model reload with new context size
    from adapters.ai.llama_cpp import cleanup_llama_service
    cleanup_llama_service()

    return await get_ai_config()
```

**Step 4: Wire AI settings into factory on startup**

In `packages/backend/api/routes/ai.py`, modify `_ensure_active_model_loaded()` to also load persisted context size:

```python
def _ensure_active_model_loaded() -> None:
    """Ensure settings.AI_MODEL_PATH and AI_N_CTX are set from persisted state."""
    # Existing model path logic stays the same...

    # Also load persisted context size (sync wrapper for startup)
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're inside an async context — settings were already loaded
        # by the config endpoint or previous call
        pass
    else:
        # Startup path — load from DB
        from core.ai_settings import get_ai_settings
        ai_config = asyncio.run(get_ai_settings())
        settings.AI_N_CTX = ai_config["context_size"]
```

Actually, simpler approach — just load AI settings in the existing startup path in `api/main.py` or wherever the app initializes. Let me check:

**Step 4 (revised): Load persisted AI settings on app startup**

Add to the app startup (wherever `_ensure_active_model_loaded` is first called or in the lifespan). The cleanest place is to make `_ensure_active_model_loaded` async-aware and have it called from a startup event. But since it's already called synchronously from each endpoint, the simplest fix is:

In the `get_ai_config` and `update_ai_config` endpoints above, we already set `settings.AI_N_CTX`. For the first request, the factory reads `settings.AI_N_CTX` which starts at 8192 (the env default). If the user previously saved a different value, it gets loaded on first GET to `/api/config/ai` — which the frontend calls on mount.

To ensure it's loaded before any AI call, add a one-time async load at the top of `_ensure_active_model_loaded`:

```python
_ai_settings_loaded = False

def _ensure_active_model_loaded() -> None:
    global _ai_settings_loaded
    if not _ai_settings_loaded:
        # Load persisted AI settings (context_size) from DB
        # This is called from async endpoints, so we can use a sync fallback
        try:
            import asyncio
            from core.ai_settings import get_ai_settings
            ai_config = asyncio.get_event_loop().run_until_complete(get_ai_settings())
            settings.AI_N_CTX = ai_config["context_size"]
        except RuntimeError:
            pass  # Already in async context; settings loaded via config endpoint
        _ai_settings_loaded = True

    # ... rest of existing logic
```

**Step 5: Commit**

```
feat: add AI settings persistence with context window configuration
```

---

### Task 2: Map-Reduce Chunked Processing in LlamaCppAIService

**Files:**
- Modify: `packages/backend/adapters/ai/llama_cpp.py`

This is the core logic. The approach:
1. Check if transcript fits in context window → single pass (existing behavior)
2. If not → split into overlapping chunks, process each, merge results

**Step 1: Add chunk splitting method**

Add to `LlamaCppAIService`:

```python
def _split_into_chunks(
    self,
    text: str,
    max_tokens_per_chunk: int,
    overlap_tokens: int = 200,
) -> list[str]:
    """Split text into token-budget-aware chunks with overlap.

    Splits on sentence boundaries when possible to avoid cutting
    mid-thought. Overlap ensures context continuity between chunks.
    """
    self._ensure_loaded()
    total_tokens = self._count_tokens(text)

    if total_tokens <= max_tokens_per_chunk:
        return [text]

    chunks = []
    # Split by sentences (period/newline boundaries)
    import re
    sentences = re.split(r'(?<=[.!?\n])\s+', text)

    current_chunk: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        sentence_tokens = self._count_tokens(sentence)

        if current_tokens + sentence_tokens > max_tokens_per_chunk and current_chunk:
            # Save current chunk
            chunks.append(" ".join(current_chunk))

            # Start new chunk with overlap from end of previous
            overlap_text = []
            overlap_count = 0
            for s in reversed(current_chunk):
                s_tokens = self._count_tokens(s)
                if overlap_count + s_tokens > overlap_tokens:
                    break
                overlap_text.insert(0, s)
                overlap_count += s_tokens

            current_chunk = overlap_text
            current_tokens = overlap_count

        current_chunk.append(sentence)
        current_tokens += sentence_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    logger.info(
        "Split transcript into %d chunks (total %d tokens, %d per chunk)",
        len(chunks), total_tokens, max_tokens_per_chunk,
    )
    return chunks
```

**Step 2: Add map-reduce summarization**

Replace the truncation logic in `summarize_transcript` with chunked processing:

```python
async def summarize_transcript(
    self,
    transcript_text: str,
    options: ChatOptions | None = None,
) -> SummarizationResult:
    """Generate a summary of a transcript.

    For transcripts that exceed the context window, uses map-reduce:
    1. Split into chunks that fit the context
    2. Summarize each chunk independently
    3. Merge chunk summaries into a final summary
    """
    options = options or ChatOptions()
    self._ensure_loaded()

    system_prompt = """You are a transcript summarization assistant. ..."""  # existing prompt

    max_response = options.max_tokens or 2048
    system_tokens = self._count_tokens(system_prompt) + 20
    available_for_content = self._n_ctx - system_tokens - max_response

    transcript_tokens = self._count_tokens(transcript_text)

    # Single pass if it fits
    if transcript_tokens <= available_for_content:
        return await self._summarize_single(transcript_text, system_prompt, options)

    # Map-reduce for long transcripts
    return await self._summarize_chunked(transcript_text, system_prompt, options)
```

```python
async def _summarize_single(
    self,
    transcript_text: str,
    system_prompt: str,
    options: ChatOptions,
) -> SummarizationResult:
    """Summarize a transcript that fits in a single context window."""
    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(
            role="user",
            content=f"Please summarize this transcript:\n\n{transcript_text}",
        ),
    ]
    response = await self.chat(messages, options)
    return self._parse_summarization_response(response.content)


async def _summarize_chunked(
    self,
    transcript_text: str,
    system_prompt: str,
    options: ChatOptions,
) -> SummarizationResult:
    """Map-reduce summarization for transcripts exceeding context window."""
    max_response = options.max_tokens or 2048
    system_tokens = self._count_tokens(system_prompt) + 20
    available_for_content = self._n_ctx - system_tokens - max_response

    # MAP: summarize each chunk
    chunks = self._split_into_chunks(transcript_text, available_for_content)
    chunk_summaries: list[str] = []

    chunk_prompt = """You are summarizing a section of a larger transcript.
Provide a concise summary of this section, noting:
- Key points discussed
- Any action items mentioned
- Main topics covered
- People mentioned or speaking

Be thorough — your summary will be combined with summaries of other sections."""

    chunk_system_tokens = self._count_tokens(chunk_prompt) + 20
    chunk_response_tokens = min(1024, max_response)
    chunk_available = self._n_ctx - chunk_system_tokens - chunk_response_tokens

    # Re-chunk with the chunk prompt's overhead if needed
    if available_for_content != chunk_available:
        chunks = self._split_into_chunks(transcript_text, chunk_available)

    logger.info("Map phase: summarizing %d chunks", len(chunks))

    for i, chunk in enumerate(chunks):
        chunk_messages = [
            ChatMessage(role="system", content=chunk_prompt),
            ChatMessage(
                role="user",
                content=f"Summarize section {i + 1} of {len(chunks)}:\n\n{chunk}",
            ),
        ]
        chunk_options = ChatOptions(
            temperature=options.temperature,
            max_tokens=chunk_response_tokens,
        )
        response = await self.chat(chunk_messages, chunk_options)
        chunk_summaries.append(response.content)

    # REDUCE: combine chunk summaries into final output
    combined = "\n\n---\n\n".join(
        f"Section {i + 1}:\n{s}" for i, s in enumerate(chunk_summaries)
    )

    # Check if combined summaries fit in one reduce pass
    reduce_tokens = self._count_tokens(combined)
    reduce_system_tokens = self._count_tokens(system_prompt) + 20
    reduce_available = self._n_ctx - reduce_system_tokens - max_response

    if reduce_tokens > reduce_available:
        # Summaries are still too long — truncate (rare edge case)
        combined = self._truncate_to_fit(combined, reduce_available)

    logger.info("Reduce phase: merging %d chunk summaries", len(chunk_summaries))

    reduce_messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(
            role="user",
            content=(
                f"The following are summaries of {len(chunks)} sections of a transcript. "
                f"Combine them into a single comprehensive summary:\n\n{combined}"
            ),
        ),
    ]
    response = await self.chat(reduce_messages, options)
    return self._parse_summarization_response(response.content)
```

**Step 3: Extract the response parsing into a shared method**

Move the existing summary parsing logic (SUMMARY/KEY POINTS/ACTION ITEMS/etc.) from `summarize_transcript` into `_parse_summarization_response(content: str) -> SummarizationResult` so both single-pass and chunked paths share it.

**Step 4: Add chunked `analyze_transcript`**

Same pattern for `analyze_transcript`:

```python
async def analyze_transcript(
    self,
    transcript_text: str,
    analysis_type: str,
    options: ChatOptions | None = None,
) -> AnalysisResult:
    """Analyze a transcript, using chunked processing for long inputs."""
    options = options or ChatOptions()
    self._ensure_loaded()

    prompts = { ... }  # existing prompts dict
    prompt = prompts.get(analysis_type, f"Perform {analysis_type} analysis on this transcript.")
    system_content = f"You are a transcript analyst. {prompt}"

    max_response = options.max_tokens or 512
    system_tokens = self._count_tokens(system_content) + 20
    available = self._n_ctx - system_tokens - max_response

    transcript_tokens = self._count_tokens(transcript_text)

    if transcript_tokens <= available:
        # Single pass
        messages = [
            ChatMessage(role="system", content=system_content),
            ChatMessage(role="user", content=f"Analyze this transcript:\n\n{transcript_text}"),
        ]
        response = await self.chat(messages, options)
        return AnalysisResult(analysis_type=analysis_type, content={"raw_analysis": response.content})

    # Chunked: analyze each chunk, then merge
    chunks = self._split_into_chunks(transcript_text, available)
    chunk_analyses: list[str] = []

    for i, chunk in enumerate(chunks):
        messages = [
            ChatMessage(role="system", content=system_content),
            ChatMessage(
                role="user",
                content=f"Analyze section {i + 1} of {len(chunks)}:\n\n{chunk}",
            ),
        ]
        response = await self.chat(messages, options)
        chunk_analyses.append(response.content)

    # Reduce
    combined = "\n\n---\n\n".join(
        f"Section {i + 1}:\n{a}" for i, a in enumerate(chunk_analyses)
    )
    combined = self._truncate_to_fit(combined, available)

    merge_messages = [
        ChatMessage(
            role="system",
            content=f"You are a transcript analyst. Merge these section-level analyses into one cohesive {analysis_type} analysis.",
        ),
        ChatMessage(
            role="user",
            content=f"Combine these analyses:\n\n{combined}",
        ),
    ]
    response = await self.chat(merge_messages, options)
    return AnalysisResult(analysis_type=analysis_type, content={"raw_analysis": response.content})
```

**Step 5: Commit**

```
feat: map-reduce chunked processing for long transcripts
```

---

### Task 3: Context Window Truncation in API Routes (ask + chat/multi)

**Files:**
- Modify: `packages/backend/api/routes/ai.py`

The `ask_about_transcript` and `chat/multi` endpoints also need chunked handling. For these, the approach is slightly different — we can't map-reduce a *question*, but we can:

1. For **ask**: If transcript is too long, chunk it, search each chunk for relevant content, then answer from the most relevant chunks.
2. For **chat/multi**: Truncate context with a clear message to the user that the transcript was too large to fit entirely.

Actually, for the chat paths, map-reduce doesn't make sense (the user is asking a specific question, not requesting a full analysis). The right approach is:

- **ask**: Use truncation but with a smarter strategy — keep the beginning (context/intro) and end (conclusions/action items) of the transcript, truncating the middle.
- **chat/multi**: Same — smart truncation with user-visible indication.

**Step 1: Replace naive truncation with smart truncation in routes**

For `ask_about_transcript`, keep the existing truncation approach (it's appropriate for Q&A — users usually ask about specific parts). The chunked approach from Task 2 handles summarize/analyze.

For `chat/multi`, the existing truncation from the previous bugfix session is appropriate — the chat assistant context is bounded. But improve the UX by including a note in the system prompt when truncation occurs:

```python
# In chat_multi_stream, after truncation:
if len(full_context) < original_context_len:
    system_content += "\n\nNote: The attached content was too large to include in full. "
    system_content += "Some content has been omitted. For complete analysis, use the Summarize or Analyze features."
```

**Step 2: Commit**

```
fix: improve truncation messaging for chat context overflow
```

---

### Task 4: Frontend — Context Window Slider in Settings

**Files:**
- Modify: `packages/frontend/src/lib/api.ts` (add AI settings types + endpoints)
- Modify: `packages/frontend/src/pages/settings/SettingsPage.tsx` (add slider UI)

**Step 1: Add types and API methods**

In `packages/frontend/src/lib/api.ts`:

```typescript
export interface AISettingsResponse {
  context_size: number;
  available_context_sizes: number[];
  max_model_context: number;
  ram_estimates: Record<number, string>;
}

export interface AISettingsUpdate {
  context_size?: number;
}
```

Add to the API client class:

```typescript
aiSettings = {
  get: () => this.request<AISettingsResponse>('/api/config/ai'),
  update: (data: AISettingsUpdate) =>
    this.request<AISettingsResponse>('/api/config/ai', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
```

**Step 2: Add context window slider to Settings AI section**

In `packages/frontend/src/pages/settings/SettingsPage.tsx`, add state and UI below the model list, inside the existing "Large Language Model" section:

Add state:
```typescript
const [aiSettings, setAiSettings] = useState<AISettingsResponse | null>(null);
const [savingAiSettings, setSavingAiSettings] = useState(false);
```

Load on mount (add to existing useEffect that loads aiModels):
```typescript
api.aiSettings.get().then(setAiSettings).catch(console.error);
```

Add UI after the model list (`</div>` after `aiModels.length === 0`) and before the info footer:

```tsx
{/* Context Window Size */}
{aiSettings && (
  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      Context Window Size
    </label>
    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
      Larger context windows let the AI process longer transcripts in a single pass,
      but require more RAM. Transcripts that exceed the context window are automatically
      processed in chunks.
    </p>

    <div className="flex items-center gap-4">
      <input
        type="range"
        min={0}
        max={aiSettings.available_context_sizes.length - 1}
        value={aiSettings.available_context_sizes.indexOf(aiSettings.context_size)}
        onChange={(e) => {
          const idx = parseInt(e.target.value);
          const newSize = aiSettings.available_context_sizes[idx];
          setAiSettings({ ...aiSettings, context_size: newSize });
        }}
        className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
      <div className="text-right min-w-[100px]">
        <span className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">
          {aiSettings.context_size >= 1024
            ? `${Math.round(aiSettings.context_size / 1024)}K`
            : aiSettings.context_size}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">tokens</span>
      </div>
    </div>

    {/* Tick marks */}
    <div className="flex justify-between mt-1 px-1">
      {aiSettings.available_context_sizes.map((size) => (
        <span key={size} className="text-[10px] text-gray-400 dark:text-gray-500">
          {size >= 1024 ? `${Math.round(size / 1024)}K` : size}
        </span>
      ))}
    </div>

    {/* RAM estimate */}
    <div className="mt-2 flex items-center justify-between">
      <span className="text-xs text-gray-500 dark:text-gray-400">
        Estimated RAM: {aiSettings.ram_estimates[aiSettings.context_size] || 'Unknown'}
      </span>
      <button
        onClick={async () => {
          setSavingAiSettings(true);
          try {
            const updated = await api.aiSettings.update({
              context_size: aiSettings.context_size,
            });
            setAiSettings(updated);
          } catch (err) {
            console.error('Failed to save AI settings:', err);
          } finally {
            setSavingAiSettings(false);
          }
        }}
        disabled={savingAiSettings}
        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {savingAiSettings ? 'Saving...' : 'Apply'}
      </button>
    </div>

    {aiSettings.context_size > 32768 && (
      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
        Large context windows (above 32K) require significantly more RAM and
        may cause slowdowns on machines with less than 16 GB of memory.
      </p>
    )}
  </div>
)}
```

**Step 3: Commit**

```
feat: context window size slider in AI settings
```

---

### Task 5: Integration — Load Persisted AI Settings on Startup

**Files:**
- Modify: `packages/backend/api/routes/ai.py` (ensure context_size loaded before first AI call)
- Modify: `packages/backend/core/factory.py` (read persisted settings)

**Step 1: Add async settings loader to ai.py**

The simplest approach: make `_ensure_active_model_loaded` also load context size from the DB on first call. Since this function is called from async endpoints, we can make it async:

Rename `_ensure_active_model_loaded` to `async _ensure_active_model_loaded` and update all callers (they're all in async endpoints so this is safe):

```python
_ai_settings_loaded = False

async def _ensure_active_model_loaded() -> None:
    """Ensure AI model path and settings are loaded from persisted state."""
    global _ai_settings_loaded

    if not _ai_settings_loaded:
        from core.ai_settings import get_ai_settings
        ai_config = await get_ai_settings()
        settings.AI_N_CTX = ai_config["context_size"]
        _ai_settings_loaded = True

    # ... existing model path loading logic (unchanged)
```

Update all callers from `_ensure_active_model_loaded()` to `await _ensure_active_model_loaded()` — there are ~8 call sites in ai.py, all in async functions.

**Step 2: Commit**

```
feat: load persisted AI context size on first AI call
```

---

### Task 6: Verification and Polish

**Step 1: Test the full flow manually**

1. Start dev server: `pnpm dev`
2. Go to Settings > AI/LLM section
3. Verify context window slider appears with correct range
4. Change to 32K, click Apply
5. Verify model reloads (check backend logs)
6. Open a long transcript, click Summarize
7. Verify chunked processing logs appear: "Split transcript into N chunks"
8. Verify complete summary with all sections
9. Test Ask with a long transcript — verify truncation works
10. Test chat with attached long transcript — verify it doesn't error

**Step 2: Test edge cases**

- No model downloaded: slider should still appear but Apply should handle gracefully
- Set context to 2K: even short transcripts should trigger chunking
- Set context to 128K: verify it works without OOM on your machine

**Step 3: Final commit**

```
feat: chunked AI processing and context window settings (v0.50.0)
```
