# Global Chat Assistant (Max) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a persistent AI chat assistant (Max) accessible via FAB from any page, supporting multi-transcript context.

**Architecture:** FAB + slide-up panel at App root level. New streaming backend endpoint for multi-transcript chat. Session-only state persistence in React.

**Tech Stack:** React, TypeScript, FastAPI, SSE streaming, Tailwind CSS

---

## Task 1: Update Model Catalog

**Files:**
- Modify: `packages/backend/core/model_catalog.py`

**Step 1: Update the model catalog**

Replace the entire file content:

```python
"""Curated model catalog for local LLM inference.

Defines available GGUF models that can be downloaded from HuggingFace.
"""

MODEL_CATALOG: dict[str, dict] = {
    "granite-3.3-8b": {
        "repo": "bartowski/ibm-granite_granite-3.3-8b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-8b-instruct-Q4_K_M.gguf",
        "size_bytes": 4_920_000_000,
        "label": "Granite 3.3 8B",
        "description": "IBM's instruct model. Recommended for chat and analysis.",
        "default": True,
    },
    "granite-3.3-2b": {
        "repo": "bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf",
        "size_bytes": 1_664_540_672,
        "label": "Granite 3.3 2B (Lite)",
        "description": "Compact model for low-RAM systems. Good for basic tasks.",
        "default": False,
    },
}
```

**Step 2: Verify import works**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from core.model_catalog import MODEL_CATALOG; print(list(MODEL_CATALOG.keys()))"`

Expected: `['granite-3.3-8b', 'granite-3.3-2b']`

**Step 3: Commit**

```bash
git add packages/backend/core/model_catalog.py
git commit -m "feat: add Granite 3.3 8B as default model, 2B as lite option"
```

---

## Task 2: Add Multi-Transcript Chat Endpoint

**Files:**
- Modify: `packages/backend/api/routes/ai.py`

**Step 1: Add request/response models after existing ChatResponse class (~line 91)**

```python
class MultiChatRequest(BaseModel):
    """Request model for multi-transcript chat."""
    message: str
    transcript_ids: list[str] = []
    history: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]
    temperature: float = 0.7


class StreamToken(BaseModel):
    """A single token in a streaming response."""
    token: str | None = None
    done: bool = False
    model: str | None = None
    error: str | None = None
```

**Step 2: Add Max's system prompt constant after the models (~line 105)**

```python
MAX_SYSTEM_PROMPT = """You are Max, the Verbatim Assistant. You help users understand and analyze their transcript recordings.

Guidelines:
- Be concise and factual
- Reference specific quotes from transcripts when relevant
- When comparing transcripts, clearly label which transcript you're referencing (e.g., "In Transcript A...")
- If asked about something not in the attached transcripts, say so
- When no transcripts are attached, help with general questions about recordings, transcription, or the app
"""
```

**Step 3: Add the multi-transcript chat endpoint before the summarize endpoint (~line 398)**

```python
@router.post("/chat/multi")
async def chat_multi_stream(
    request: MultiChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Stream a chat response with multi-transcript context."""
    _ensure_active_model_loaded()
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    # Build context from transcripts
    context_parts = []
    if request.transcript_ids:
        for i, tid in enumerate(request.transcript_ids):
            label = chr(65 + i)  # A, B, C, ...
            try:
                text = await get_transcript_text(db, tid)
                # Get transcript title
                result = await db.execute(select(Transcript).where(Transcript.id == tid))
                transcript = result.scalar_one_or_none()
                title = transcript.title if transcript else f"Transcript {label}"
                context_parts.append(f"=== Transcript {label}: {title} ===\n{text}\n")
            except Exception:
                logger.warning(f"Could not load transcript {tid}")
                continue

    # Build system message
    system_content = MAX_SYSTEM_PROMPT
    if context_parts:
        system_content += f"\n\nYou have access to {len(context_parts)} transcript(s):\n\n"
        system_content += "\n".join(context_parts)
    else:
        system_content += "\n\nNo transcripts are currently attached. Help with general questions."

    # Build messages list
    messages = [ChatMessage(role="system", content=system_content)]

    # Add history
    for msg in request.history:
        messages.append(ChatMessage(role=msg["role"], content=msg["content"]))

    # Add current message
    messages.append(ChatMessage(role="user", content=request.message))

    options = ChatOptions(temperature=request.temperature, max_tokens=1024)

    async def generate():
        try:
            model_name = "unknown"
            async for chunk in ai_service.chat_stream(messages, options):
                if chunk.model:
                    model_name = chunk.model
                if chunk.content:
                    yield f"data: {json.dumps({'token': chunk.content})}\n\n"
                if chunk.finish_reason:
                    yield f"data: {json.dumps({'done': True, 'model': model_name})}\n\n"
        except Exception as e:
            logger.exception("Multi-chat stream failed")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**Step 4: Verify endpoint loads**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from api.routes.ai import router; print([r.path for r in router.routes if 'multi' in r.path])"`

Expected: `['/chat/multi']`

**Step 5: Commit**

```bash
git add packages/backend/api/routes/ai.py
git commit -m "feat: add /api/ai/chat/multi endpoint for multi-transcript streaming chat"
```

---

## Task 3: Add Frontend API Client Method

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add ChatMultiRequest type after AIChatRequest (~line 75)**

Find `export interface AIChatRequest` and add after it:

```typescript
export interface ChatMultiRequest {
  message: string;
  transcript_ids: string[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
}

export interface ChatStreamToken {
  token?: string;
  done?: boolean;
  model?: string;
  error?: string;
}
```

**Step 2: Add chatMultiStream method to the ai object (~line 1040)**

Find the `ai = {` section and add after the `ask` method:

```typescript
    chatMultiStream: async function* (
      data: ChatMultiRequest
    ): AsyncGenerator<ChatStreamToken> {
      const response = await fetch(`${this.baseUrl}/api/ai/chat/multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data as ChatStreamToken;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    }.bind(this),
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: add chatMultiStream API method for multi-transcript chat"
```

---

## Task 4: Create ChatFAB Component

**Files:**
- Create: `packages/frontend/src/components/ai/ChatFAB.tsx`

**Step 1: Create the FAB component**

```typescript
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface ChatFABProps {
  onClick: () => void;
  isOpen: boolean;
}

export function ChatFAB({ onClick, isOpen }: ChatFABProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api.ai.status()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  if (isOpen) return null; // Hide FAB when panel is open

  return (
    <button
      onClick={onClick}
      className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
        aiAvailable
          ? 'bg-blue-600 hover:bg-blue-700 hover:scale-105'
          : 'bg-gray-400 cursor-not-allowed'
      }`}
      disabled={aiAvailable === false}
      title={aiAvailable ? 'Verbatim Assistant' : 'AI not available'}
    >
      {/* Sparkle icon */}
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      {/* Pulse animation when available */}
      {aiAvailable && (
        <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-25" />
      )}
    </button>
  );
}
```

**Step 2: Verify file created and TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatFAB.tsx
git commit -m "feat: add ChatFAB component for AI assistant button"
```

---

## Task 5: Create ChatMessages Component

**Files:**
- Create: `packages/frontend/src/components/ai/ChatMessages.tsx`

**Step 1: Create the messages display component**

```typescript
import { useEffect, useRef } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
}

export function ChatMessages({ messages, isStreaming, streamingContent }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <div className="w-12 h-12 mx-auto rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100">Hi, I'm Max!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
            I can help you analyze your transcripts. Attach some transcripts or ask me anything!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            }`}
          >
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          </div>
        </div>
      ))}
      {isStreaming && streamingContent && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
            <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
            <span className="inline-block w-2 h-4 ml-1 bg-gray-400 animate-pulse" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatMessages.tsx
git commit -m "feat: add ChatMessages component for conversation display"
```

---

## Task 6: Create ChatInput Component

**Files:**
- Create: `packages/frontend/src/components/ai/ChatInput.tsx`

**Step 1: Create the input component**

```typescript
import { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onAttachClick: () => void;
  disabled: boolean;
  attachedCount: number;
}

export function ChatInput({ onSend, onAttachClick, disabled, attachedCount }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onAttachClick}
          className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Attach transcripts"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {attachedCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center">
              {attachedCount}
            </span>
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Max anything..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="shrink-0 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </form>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatInput.tsx
git commit -m "feat: add ChatInput component for message input"
```

---

## Task 7: Create TranscriptPicker Component

**Files:**
- Create: `packages/frontend/src/components/ai/TranscriptPicker.tsx`

**Step 1: Create the picker component**

```typescript
import { useState, useEffect, useRef } from 'react';
import { api, type Recording } from '@/lib/api';

export interface AttachedTranscript {
  id: string;
  title: string;
}

interface TranscriptPickerProps {
  attached: AttachedTranscript[];
  onAttach: (transcript: AttachedTranscript) => void;
  onDetach: (id: string) => void;
  onClose: () => void;
}

export function TranscriptPicker({ attached, onAttach, onDetach, onClose }: TranscriptPickerProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.recordings.list({ status: 'completed', pageSize: 50 })
      .then((r) => setRecordings(r.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const attachedIds = new Set(attached.map((t) => t.id));
  const filtered = recordings.filter(
    (r) => r.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (recording: Recording) => {
    if (attachedIds.has(recording.id)) {
      onDetach(recording.id);
    } else {
      if (attached.length >= 5) {
        alert('Maximum 5 transcripts can be attached. Adding more may reduce response quality.');
        return;
      }
      onAttach({ id: recording.id, title: recording.title });
    }
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-hidden flex flex-col"
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts..."
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">No transcripts found</div>
        ) : (
          filtered.slice(0, 20).map((recording) => (
            <label
              key={recording.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={attachedIds.has(recording.id)}
                onChange={() => handleToggle(recording)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {recording.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(recording.created_at).toLocaleDateString()}
                </p>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/TranscriptPicker.tsx
git commit -m "feat: add TranscriptPicker component for attaching transcripts"
```

---

## Task 8: Create ChatHeader Component

**Files:**
- Create: `packages/frontend/src/components/ai/ChatHeader.tsx`

**Step 1: Create the header component**

```typescript
import { type AttachedTranscript } from './TranscriptPicker';

interface ChatHeaderProps {
  attached: AttachedTranscript[];
  onDetach: (id: string) => void;
  onClose: () => void;
}

export function ChatHeader({ attached, onDetach, onClose }: ChatHeaderProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Max</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attached.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            >
              <span className="truncate max-w-[120px]">{t.title}</span>
              <button
                onClick={() => onDetach(t.id)}
                className="hover:text-blue-900 dark:hover:text-blue-100"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatHeader.tsx
git commit -m "feat: add ChatHeader component with transcript chips"
```

---

## Task 9: Create ChatPanel Component

**Files:**
- Create: `packages/frontend/src/components/ai/ChatPanel.tsx`

**Step 1: Create the main panel component**

```typescript
import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { ChatHeader } from './ChatHeader';
import { ChatMessages, type ChatMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { TranscriptPicker, type AttachedTranscript } from './TranscriptPicker';

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  attached: AttachedTranscript[];
  setAttached: React.Dispatch<React.SetStateAction<AttachedTranscript[]>>;
}

export function ChatPanel({
  isOpen,
  onClose,
  messages,
  setMessages,
  attached,
  setAttached,
}: ChatPanelProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const handleSend = useCallback(async (message: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      let fullContent = '';

      for await (const token of api.ai.chatMultiStream({
        message,
        transcript_ids: attached.map((t) => t.id),
        history,
        temperature: 0.7,
      })) {
        if (token.error) {
          throw new Error(token.error);
        }
        if (token.token) {
          fullContent += token.token;
          setStreamingContent(fullContent);
        }
        if (token.done) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: fullContent,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setStreamingContent('');
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [messages, attached, setMessages]);

  const handleAttach = useCallback((transcript: AttachedTranscript) => {
    setAttached((prev) => [...prev, transcript]);
  }, [setAttached]);

  const handleDetach = useCallback((id: string) => {
    setAttached((prev) => prev.filter((t) => t.id !== id));
  }, [setAttached]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-40 w-[400px] h-[500px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-200">
      <ChatHeader attached={attached} onDetach={handleDetach} onClose={onClose} />
      <ChatMessages
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />
      <div className="relative">
        {showPicker && (
          <TranscriptPicker
            attached={attached}
            onAttach={handleAttach}
            onDetach={handleDetach}
            onClose={() => setShowPicker(false)}
          />
        )}
        <ChatInput
          onSend={handleSend}
          onAttachClick={() => setShowPicker(!showPicker)}
          disabled={isStreaming}
          attachedCount={attached.length}
        />
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatPanel.tsx
git commit -m "feat: add ChatPanel component as main chat container"
```

---

## Task 10: Integrate Chat into App.tsx

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Add imports at the top of the file (after existing imports, ~line 14)**

```typescript
import { ChatFAB } from '@/components/ai/ChatFAB';
import { ChatPanel } from '@/components/ai/ChatPanel';
import type { ChatMessage } from '@/components/ai/ChatMessages';
import type { AttachedTranscript } from '@/components/ai/TranscriptPicker';
```

**Step 2: Add chat state inside the App component (after the navigation state, ~line 96)**

```typescript
  // Chat assistant state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [attachedTranscripts, setAttachedTranscripts] = useState<AttachedTranscript[]>([]);
```

**Step 3: Add auto-attach effect (after other useEffects, ~line 235)**

```typescript
  // Auto-attach current transcript when opening chat from transcript page
  const handleOpenChat = useCallback(() => {
    if (navigation.type === 'transcript' && !isChatOpen) {
      // Check if this transcript is already attached
      const alreadyAttached = attachedTranscripts.some(
        (t) => t.id === navigation.recordingId
      );
      if (!alreadyAttached) {
        // Fetch recording title and attach
        api.recordings.get(navigation.recordingId).then((recording) => {
          setAttachedTranscripts((prev) => [
            ...prev,
            { id: recording.id, title: recording.title },
          ]);
        }).catch(() => {});
      }
    }
    setIsChatOpen(true);
  }, [navigation, isChatOpen, attachedTranscripts]);
```

**Step 4: Add FAB and ChatPanel to the render (before the closing `</div>` of the root, ~line 380)**

Find the line `</div>` that closes `<div className="min-h-screen bg-background flex">` and add before it:

```typescript
      {/* Chat Assistant */}
      <ChatFAB onClick={handleOpenChat} isOpen={isChatOpen} />
      <ChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        setMessages={setChatMessages}
        attached={attachedTranscripts}
        setAttached={setAttachedTranscripts}
      />
```

**Step 5: Verify TypeScript compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors

**Step 6: Build to verify everything works**

Run: `cd packages/frontend && npm run build`

Expected: Build succeeds

**Step 7: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat: integrate ChatFAB and ChatPanel into App root"
```

---

## Task 11: Final Testing and Cleanup

**Step 1: Run full frontend build**

Run: `cd packages/frontend && npm run build`

Expected: Build succeeds with no errors

**Step 2: Verify backend starts**

Run: `cd packages/backend && source .venv/bin/activate && python -c "from api.main import app; print('OK')"`

Expected: `OK`

**Step 3: Final commit with version bump**

```bash
git add -A
git commit -m "feat(#37,#46): complete Global Chat Assistant (Max) implementation

- Add Granite 3.3 8B as default model, 2B as lite option
- Add /api/ai/chat/multi endpoint for multi-transcript streaming chat
- Add ChatFAB component (floating button, bottom-right)
- Add ChatPanel with slide-up animation
- Add ChatMessages, ChatInput, ChatHeader, TranscriptPicker components
- Auto-attach current transcript when opening from transcript page
- Session-based conversation persistence

Closes #37, Closes #46"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Model Catalog | Add 8B model, update 2B label |
| 2 | Backend API | Add `/chat/multi` streaming endpoint |
| 3 | API Client | Add `chatMultiStream` method |
| 4 | ChatFAB | Floating action button |
| 5 | ChatMessages | Message display with streaming |
| 6 | ChatInput | Message input with attach button |
| 7 | TranscriptPicker | Dropdown for selecting transcripts |
| 8 | ChatHeader | Title and transcript chips |
| 9 | ChatPanel | Main container component |
| 10 | App.tsx | Integration and state management |
| 11 | Testing | Final verification |
