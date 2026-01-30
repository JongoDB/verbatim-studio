# Global Chat Assistant (Max) - Design Document

## Overview

A persistent AI chat assistant accessible from any page via a floating action button (FAB). Users can attach multiple transcripts for cross-transcript analysis and comparison.

**Assistant Name:** Max, the Verbatim Assistant

## Features

1. **Cross-transcript queries** - "Compare the themes in interview A vs B"
2. **Project-level analysis** - "Summarize all transcripts in Project X"
3. **Quick access from anywhere** - FAB visible on every page
4. **Persistent conversation** - Chat survives navigation within session
5. **General assistant mode** - Help with non-transcript tasks when nothing attached

## UI Design

### Floating Action Button (FAB)

- Position: `bottom-6 right-6`, fixed
- Size: 56px circle
- Icon: Sparkle/AI icon
- Colors: Blue (`bg-blue-600 hover:bg-blue-700`)
- Pulse animation when AI available, muted when unavailable
- Tooltip: "Verbatim Assistant"
- Z-index: 40

### Chat Panel

- Position: `bottom-24 right-6`, fixed (above FAB)
- Size: 400px wide × 500px tall, expandable to 600px
- Animation: slide up + fade in (200ms)
- Rounded corners, shadow-xl

**Sections:**

1. **Header** - "Max" title, attached transcript chips, minimize button
2. **Messages** - Scrollable, user right-aligned (blue), Max left-aligned (gray), markdown rendering
3. **Input** - Textarea with send button, "+" button for transcript picker

### Transcript Picker

- Dropdown below "+" button, 320px wide
- Search input at top
- List shows: title, date, duration
- Checkbox multi-select
- Soft limit: 5 transcripts with warning

### Context Behavior

- On transcript page: auto-attach current transcript when opening chat
- On other pages: chat opens empty
- Attached transcripts shown as removable chips

## Architecture

### Frontend Components

```
App.tsx (root level)
├── ChatFAB.tsx          # Floating button
├── ChatPanel.tsx        # Slide-up panel container
│   ├── ChatHeader.tsx   # Title, transcript chips, minimize
│   ├── ChatMessages.tsx # Conversation with streaming
│   ├── ChatInput.tsx    # Message input
│   └── TranscriptPicker.tsx  # Dropdown for attaching
```

### App-Level State

```typescript
interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  attachedTranscripts: { id: string; title: string }[];
  isStreaming: boolean;
}
```

Persistence: React state only (clears on browser refresh)

## Backend API

### New Endpoint

```
POST /api/ai/chat/multi
```

**Request:**
```json
{
  "message": "Compare the key themes discussed",
  "transcript_ids": ["uuid-1", "uuid-2"],
  "history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ],
  "temperature": 0.7
}
```

**Response (streaming SSE):**
```
data: {"token": "The"}
data: {"token": " main"}
...
data: {"done": true, "model": "granite-3.3-8b"}
```

### Context Building

1. Fetch all requested transcripts from DB
2. Build system prompt with transcript texts labeled (Transcript A, B, etc.)
3. Append conversation history + new user message
4. Stream response via SSE

### Context Limits

- Warn user if combined transcript text exceeds ~6000 tokens
- Show estimated token count in UI

## Max's Persona

```
You are Max, the Verbatim Assistant. You help users understand and analyze their transcript recordings.

Guidelines:
- Be concise and factual
- Reference specific quotes from transcripts when relevant
- When comparing transcripts, clearly label which transcript you're referencing
- If asked about something not in the attached transcripts, say so
- When no transcripts are attached, help with general questions about recordings, transcription, or the app

Current context:
{attached_transcripts_info}
```

## Model Configuration

### Default Model (Recommended)

```python
"granite-3.3-8b": {
    "repo": "bartowski/ibm-granite_granite-3.3-8b-instruct-GGUF",
    "filename": "ibm-granite_granite-3.3-8b-instruct-Q4_K_M.gguf",
    "size_bytes": 4_900_000_000,
    "label": "Granite 3.3 8B",
    "description": "IBM's instruct model. Recommended for chat and analysis.",
    "default": True,
}
```

### Lite Model (Low-RAM)

```python
"granite-3.3-2b": {
    "repo": "bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF",
    "filename": "ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf",
    "size_bytes": 1_664_540_672,
    "label": "Granite 3.3 2B (Lite)",
    "description": "Compact model for low-RAM systems. Good for basic tasks.",
    "default": False,
}
```

## Files to Create

- `packages/frontend/src/components/ai/ChatFAB.tsx`
- `packages/frontend/src/components/ai/ChatPanel.tsx`
- `packages/frontend/src/components/ai/ChatHeader.tsx`
- `packages/frontend/src/components/ai/ChatMessages.tsx`
- `packages/frontend/src/components/ai/ChatInput.tsx`
- `packages/frontend/src/components/ai/TranscriptPicker.tsx`

## Files to Modify

- `packages/frontend/src/app/App.tsx` - Add chat state, FAB, and Panel at root
- `packages/backend/api/routes/ai.py` - Add `/chat/multi` endpoint
- `packages/backend/core/model_catalog.py` - Add 8B model, update 2B label

## Related Issues

- #37 - AI Chat Assistant
- #46 - AI Chat: Persistent floating chat assistant button (FAB)
