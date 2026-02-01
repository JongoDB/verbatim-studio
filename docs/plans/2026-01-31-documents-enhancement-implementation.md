# Documents Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Documents feature by implementing Notes UI, Document RAG integration, OCR improvements, and fixing critical bugs.

**Architecture:** Backend fixes first (unblock processing), then OCR improvements (reliability), then RAG endpoints (search + chat), then frontend Notes UI (user-facing feature). Each phase builds on the previous.

**Tech Stack:** Python/FastAPI backend, React/TypeScript frontend, SQLAlchemy ORM, sentence-transformers for embeddings, Tailwind CSS + shadcn/ui components.

---

## Phase 1: Bug Fixes

### Task 1.1: Remove Broken PDF Preview Code

**Files:**
- Modify: `packages/backend/jobs/process_document.py`

**Step 1: Read current file to understand structure**

The file has:
- Line 11: imports `OFFICE_MIME_TYPES` (doesn't exist)
- Lines 55-56: calls `_convert_to_pdf_preview()`
- Lines 74-94: defines `_convert_to_pdf_preview()` function

**Step 2: Remove the broken import and code**

Remove line 11's import of `OFFICE_MIME_TYPES`, remove lines 54-56 (the if block calling preview), and remove the entire `_convert_to_pdf_preview` function (lines 74-94).

After edit, the imports section should be:
```python
"""Background job for processing documents."""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from persistence.models import Document, DocumentEmbedding
from services.document_processor import document_processor
from services.storage import storage_service

logger = logging.getLogger(__name__)
```

And the `process_document_job` function should go directly from updating extracted content to generating embeddings:
```python
        # Update document with extracted content
        doc.extracted_text = result.get("text")
        doc.extracted_markdown = result.get("markdown")
        doc.page_count = result.get("page_count")
        doc.metadata_.update(result.get("metadata", {}))

        # Generate embeddings if text was extracted
        if doc.extracted_text and len(doc.extracted_text.strip()) > 0:
            _generate_embeddings(db, doc)
```

**Step 3: Verify syntax**

Run: `cd packages/backend && python -c "from jobs.process_document import process_document_job; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add packages/backend/jobs/process_document.py
git commit -m "fix: remove broken PDF preview code

The convert_to_pdf() method was never implemented and OFFICE_MIME_TYPES
was never exported. Frontend renders Office docs natively, so this
feature is unnecessary."
```

---

### Task 1.2: Fix Embedding Generation Method Call

**Files:**
- Modify: `packages/backend/jobs/process_document.py`
- Reference: `packages/backend/services/embedding.py`

**Step 1: Understand the embedding service API**

The embedding service has:
- `embed_texts(texts: list[str]) -> list[list[float]]` - batch embed
- `embed_query(query: str) -> list[float]` - single query embed
- `embedding_to_bytes(embedding: list[float]) -> bytes` - convert for storage

**Step 2: Fix the `_generate_embeddings` function**

Replace the current broken loop with batched embedding:

```python
def _generate_embeddings(db: Session, doc: Document) -> None:
    """Generate and store embeddings for document chunks."""
    from services.embedding import embedding_service

    if not embedding_service.is_available():
        logger.warning("Embedding service not available, skipping embeddings")
        return

    # Delete existing embeddings for this document
    existing = db.scalars(
        select(DocumentEmbedding).where(DocumentEmbedding.document_id == doc.id)
    ).all()
    for emb in existing:
        db.delete(emb)

    # Chunk the text
    chunks = _chunk_text(doc.extracted_text, max_tokens=500)

    if not chunks:
        logger.info(f"No chunks generated for document {doc.id}")
        return

    # Batch embed all chunks at once
    chunk_texts = [chunk["text"] for chunk in chunks]
    try:
        embeddings = embedding_service.embed_texts(chunk_texts)
    except Exception as e:
        logger.error(f"Failed to generate embeddings: {e}")
        return

    # Store each embedding
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        doc_embedding = DocumentEmbedding(
            document_id=doc.id,
            chunk_index=i,
            chunk_text=chunk["text"],
            chunk_metadata=chunk.get("metadata", {}),
            embedding=embedding_service.embedding_to_bytes(embedding),
            model_used=embedding_service.model_name,
        )
        db.add(doc_embedding)

    db.commit()
    logger.info(f"Generated {len(chunks)} embeddings for document {doc.id}")
```

**Step 3: Verify syntax**

Run: `cd packages/backend && python -c "from jobs.process_document import _generate_embeddings; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add packages/backend/jobs/process_document.py
git commit -m "fix: use correct embedding service method for documents

Changed from embed() (doesn't exist) to embed_texts() with batching
for better efficiency. Also properly converts to bytes for storage."
```

---

## Phase 2: OCR Improvements

### Task 2.1: Add OCR Availability Checks

**Files:**
- Modify: `packages/backend/services/document_processor.py`

**Step 1: Add module-level availability checks at top of file**

After the imports and before the class, add:

```python
def _check_chandra_available() -> bool:
    """Check if Chandra OCR is installed."""
    try:
        from chandra_ocr import ocr
        return True
    except ImportError:
        return False


def _check_pymupdf_available() -> bool:
    """Check if PyMuPDF is installed."""
    try:
        import fitz
        return True
    except ImportError:
        return False


CHANDRA_AVAILABLE = _check_chandra_available()
PYMUPDF_AVAILABLE = _check_pymupdf_available()
```

**Step 2: Update `_process_pdf` to use availability flags**

```python
def _process_pdf(self, file_path: Path) -> dict:
    """Process PDF using Chandra OCR with PyMuPDF fallback."""
    if CHANDRA_AVAILABLE:
        try:
            from chandra_ocr import ocr
            logger.info(f"Processing {file_path.name} with Chandra OCR")
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": result.page_count if hasattr(result, 'page_count') else None,
                "metadata": {
                    "ocr_engine": "chandra",
                    "ocr_confidence": getattr(result, 'confidence', None),
                },
            }
        except Exception as e:
            logger.warning(f"Chandra OCR failed, falling back to PyMuPDF: {e}")
            return self._process_pdf_fallback(file_path)
    else:
        logger.info(f"Chandra OCR not available, using PyMuPDF for {file_path.name}")
        return self._process_pdf_fallback(file_path)
```

**Step 3: Update `_process_pdf_fallback` to check availability**

```python
def _process_pdf_fallback(self, file_path: Path) -> dict:
    """Fallback PDF processing using PyMuPDF."""
    if not PYMUPDF_AVAILABLE:
        logger.error("No PDF processing library available (install chandra-ocr or pymupdf)")
        return {
            "text": "",
            "markdown": "",
            "page_count": None,
            "metadata": {"error": "No PDF processor available"},
        }

    try:
        import fitz  # PyMuPDF
        logger.info(f"Processing {file_path.name} with PyMuPDF")
        doc = fitz.open(file_path)
        text_parts = []
        for page in doc:
            text_parts.append(page.get_text())
        text = "\n\n".join(text_parts)
        page_count = len(doc)
        doc.close()
        return {
            "text": text,
            "markdown": text,
            "page_count": page_count,
            "metadata": {"ocr_engine": "pymupdf"},
        }
    except Exception as e:
        logger.error(f"PyMuPDF processing failed: {e}")
        return {"text": "", "markdown": "", "page_count": None, "metadata": {"error": str(e)}}
```

**Step 4: Update `_process_image` similarly**

```python
def _process_image(self, file_path: Path) -> dict:
    """Process image using Chandra OCR."""
    if not CHANDRA_AVAILABLE:
        logger.warning(f"Chandra OCR not available for image processing: {file_path.name}")
        return {
            "text": "",
            "markdown": "",
            "page_count": 1,
            "metadata": {"error": "No OCR processor available for images"},
        }

    try:
        from chandra_ocr import ocr
        logger.info(f"Processing {file_path.name} with Chandra OCR")
        result = ocr(str(file_path), output_format="markdown")
        return {
            "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
            "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
            "page_count": 1,
            "metadata": {
                "ocr_engine": "chandra",
                "ocr_confidence": getattr(result, 'confidence', None),
            },
        }
    except Exception as e:
        logger.error(f"Image OCR failed: {e}")
        return {"text": "", "markdown": "", "page_count": 1, "metadata": {"error": str(e)}}
```

**Step 5: Verify syntax**

Run: `cd packages/backend && python -c "from services.document_processor import document_processor, CHANDRA_AVAILABLE, PYMUPDF_AVAILABLE; print(f'Chandra: {CHANDRA_AVAILABLE}, PyMuPDF: {PYMUPDF_AVAILABLE}')"`

**Step 6: Commit**

```bash
git add packages/backend/services/document_processor.py
git commit -m "feat: add OCR availability checks and confidence tracking

- Check Chandra/PyMuPDF availability at module load
- Avoid repeated import attempts
- Store OCR confidence in metadata when available
- Better error messages when no processor available"
```

---

## Phase 3: Document RAG Integration

### Task 3.1: Add Document Search Endpoint

**Files:**
- Modify: `packages/backend/api/routes/search.py`

**Step 1: Add imports and response models**

Add to the imports section:
```python
from persistence.models import Document, DocumentEmbedding
```

Add response models after existing models:
```python
class DocumentSearchResult(BaseModel):
    """Single document search result."""
    document_id: str
    document_title: str
    chunk_text: str
    chunk_index: int
    similarity: float
    page: int | None = None


class DocumentSearchResponse(BaseModel):
    """Document search response."""
    results: list[DocumentSearchResult]
    total: int
```

**Step 2: Add the document search endpoint**

Add after the existing search endpoints:

```python
@router.get("/documents", response_model=DocumentSearchResponse)
async def search_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    query: Annotated[str, Query(min_length=1, description="Search query")],
    project_id: Annotated[str | None, Query(description="Filter by project")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    threshold: Annotated[float, Query(ge=0, le=1)] = 0.3,
) -> DocumentSearchResponse:
    """Semantic search across document content."""
    from services.embedding import embedding_service

    if not embedding_service.is_available():
        return DocumentSearchResponse(results=[], total=0)

    # Embed the query
    try:
        query_embedding = embedding_service.embed_query(query)
    except Exception as e:
        logger.error(f"Failed to embed query: {e}")
        return DocumentSearchResponse(results=[], total=0)

    # Fetch document embeddings
    stmt = (
        select(DocumentEmbedding, Document)
        .join(Document, DocumentEmbedding.document_id == Document.id)
        .where(Document.status == "completed")
    )
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)

    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return DocumentSearchResponse(results=[], total=0)

    # Compute similarities
    scored_results = []
    for doc_emb, doc in rows:
        emb_vector = embedding_service.bytes_to_embedding(doc_emb.embedding)
        similarity = _cosine_similarity(query_embedding, emb_vector)

        if similarity >= threshold:
            scored_results.append(DocumentSearchResult(
                document_id=doc.id,
                document_title=doc.title,
                chunk_text=doc_emb.chunk_text[:500],  # Truncate for response
                chunk_index=doc_emb.chunk_index,
                similarity=round(similarity, 4),
                page=doc_emb.chunk_metadata.get("page"),
            ))

    # Sort by similarity descending
    scored_results.sort(key=lambda x: x.similarity, reverse=True)

    return DocumentSearchResponse(
        results=scored_results[:limit],
        total=len(scored_results),
    )
```

**Step 3: Verify the cosine similarity helper exists**

Check that `_cosine_similarity` function exists in the file (it should from the existing semantic search implementation).

**Step 4: Verify syntax**

Run: `cd packages/backend && python -c "from api.routes.search import search_documents; print('OK')"`

**Step 5: Commit**

```bash
git add packages/backend/api/routes/search.py
git commit -m "feat: add semantic search endpoint for documents

GET /search/documents with query, project_id filter, limit, threshold.
Returns document chunks ranked by cosine similarity to query embedding."
```

---

### Task 3.2: Add Documents to Global Search

**Files:**
- Modify: `packages/backend/api/routes/search.py`

**Step 1: Update the global search endpoint**

Find the `search_global` function and update it to include documents. Add document title search alongside recording search, and add document semantic results alongside segment semantic results.

In the global search response model, ensure there's a type field:
```python
class GlobalSearchResult(BaseModel):
    """Unified search result."""
    id: str
    type: Literal["recording", "segment", "document"]
    title: str
    snippet: str
    similarity: float | None = None
    # Additional context
    recording_id: str | None = None
    document_id: str | None = None
```

Update the `search_global` function to:
1. Search document titles with ILIKE (keyword)
2. Include document chunks in semantic search
3. Merge results with type field

**Step 2: Commit**

```bash
git add packages/backend/api/routes/search.py
git commit -m "feat: include documents in global search

Documents now appear in /search/global results alongside recordings
and transcript segments."
```

---

### Task 3.3: Add Document Context to AI Chat

**Files:**
- Modify: `packages/backend/api/routes/ai.py`

**Step 1: Update the MultiChatRequest model**

Find the `MultiChatRequest` class and add `document_ids`:

```python
class MultiChatRequest(BaseModel):
    """Request for multi-source chat."""
    recording_ids: list[str] = []
    document_ids: list[str] = []
    message: str

    @model_validator(mode='after')
    def check_at_least_one_source(self):
        if not self.recording_ids and not self.document_ids:
            raise ValueError("At least one recording_id or document_id required")
        return self
```

**Step 2: Update the chat_multi endpoint**

In the `chat_multi` function, after fetching recordings and building their context, add document context fetching:

```python
# Fetch documents and build context
if request.document_ids:
    doc_result = await db.execute(
        select(Document)
        .where(Document.id.in_(request.document_ids))
        .where(Document.status == "completed")
    )
    documents = doc_result.scalars().all()

    for i, doc in enumerate(documents):
        label = chr(ord('A') + len(contexts))  # Continue labeling after recordings
        content = doc.extracted_markdown or doc.extracted_text or ""
        if content:
            contexts.append(f"Document {label} ({doc.title}):\n{content[:8000]}")  # Limit context size
```

**Step 3: Add Document import**

Add to imports:
```python
from persistence.models import Document
```

**Step 4: Verify syntax**

Run: `cd packages/backend && python -c "from api.routes.ai import chat_multi; print('OK')"`

**Step 5: Commit**

```bash
git add packages/backend/api/routes/ai.py
git commit -m "feat: add document context support to AI chat

POST /ai/chat/multi now accepts document_ids alongside recording_ids.
Documents are labeled and included in the chat context."
```

---

### Task 3.4: Update Frontend API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add document search types and method**

Add types:
```typescript
export interface DocumentSearchResult {
  document_id: string
  document_title: string
  chunk_text: string
  chunk_index: number
  similarity: number
  page: number | null
}

export interface DocumentSearchResponse {
  results: DocumentSearchResult[]
  total: number
}
```

Add to the search object:
```typescript
search: {
  // ... existing methods
  documents: async (query: string, projectId?: string, limit = 20): Promise<DocumentSearchResponse> => {
    const params = new URLSearchParams({ query, limit: limit.toString() })
    if (projectId) params.set('project_id', projectId)
    const response = await fetch(`${API_BASE}/search/documents?${params}`)
    if (!response.ok) throw new Error('Document search failed')
    return response.json()
  },
}
```

**Step 2: Update chatMulti to accept documentIds**

Find the `chatMulti` method and update it:
```typescript
chatMulti: async (
  recordingIds: string[],
  documentIds: string[],
  message: string
): Promise<ChatResponse> => {
  const response = await fetch(`${API_BASE}/ai/chat/multi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recording_ids: recordingIds,
      document_ids: documentIds,
      message,
    }),
  })
  if (!response.ok) throw new Error('Chat failed')
  return response.json()
}
```

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: add document search and chat API methods

- api.search.documents() for semantic document search
- Updated api.ai.chatMulti() to accept documentIds"
```

---

## Phase 4: Notes UI

### Task 4.1: Create AnchorBadge Component

**Files:**
- Create: `packages/frontend/src/components/documents/AnchorBadge.tsx`

**Step 1: Create the component**

```typescript
import { FileText, Hash, MousePointer, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AnchorBadgeProps {
  type: 'page' | 'paragraph' | 'selection' | 'timestamp'
  data: Record<string, unknown>
  className?: string
}

const icons = {
  page: FileText,
  paragraph: Hash,
  selection: MousePointer,
  timestamp: Clock,
}

export function AnchorBadge({ type, data, className }: AnchorBadgeProps) {
  const Icon = icons[type] || FileText

  const label = (() => {
    switch (type) {
      case 'page':
        return `Page ${data.page}`
      case 'paragraph':
        return `¶${data.paragraph}`
      case 'selection':
        return data.text ? `"${String(data.text).slice(0, 20)}..."` : 'Selection'
      case 'timestamp':
        return `${data.time}s`
      default:
        return type
    }
  })()

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        'bg-muted px-1.5 py-0.5 rounded',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/AnchorBadge.tsx
git commit -m "feat: add AnchorBadge component for note anchors

Displays anchor type icon and formatted value (page number,
paragraph, selection preview, or timestamp)."
```

---

### Task 4.2: Create NoteEditor Component

**Files:**
- Create: `packages/frontend/src/components/documents/NoteEditor.tsx`

**Step 1: Create the component**

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AnchorBadge } from './AnchorBadge'

interface NoteEditorProps {
  initialContent?: string
  anchorType: 'page' | 'paragraph' | 'selection' | 'timestamp'
  anchorData: Record<string, unknown>
  onSave: (content: string) => void
  onCancel: () => void
  isLoading?: boolean
}

export function NoteEditor({
  initialContent = '',
  anchorType,
  anchorData,
  onSave,
  onCancel,
  isLoading = false,
}: NoteEditorProps) {
  const [content, setContent] = useState(initialContent)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (content.trim()) {
      onSave(content.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 border rounded-lg bg-card">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Anchor:</span>
        <AnchorBadge type={anchorType} data={anchorData} />
      </div>

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your note..."
        rows={3}
        autoFocus
        disabled={isLoading}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={!content.trim() || isLoading}>
          {isLoading ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/NoteEditor.tsx
git commit -m "feat: add NoteEditor component for creating/editing notes

Form with textarea, anchor badge display, save/cancel buttons.
Supports loading state during save."
```

---

### Task 4.3: Create NoteItem Component

**Files:**
- Create: `packages/frontend/src/components/documents/NoteItem.tsx`

**Step 1: Create the component**

```typescript
import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AnchorBadge } from './AnchorBadge'
import { NoteEditor } from './NoteEditor'
import { Note } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

interface NoteItemProps {
  note: Note
  onUpdate: (noteId: string, content: string) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
  onNavigate: (anchorType: string, anchorData: Record<string, unknown>) => void
}

export function NoteItem({ note, onUpdate, onDelete, onNavigate }: NoteItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async (content: string) => {
    setIsLoading(true)
    try {
      await onUpdate(note.id, content)
      setIsEditing(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    setIsLoading(true)
    try {
      await onDelete(note.id)
    } finally {
      setIsLoading(false)
    }
  }

  if (isEditing) {
    return (
      <NoteEditor
        initialContent={note.content}
        anchorType={note.anchor_type as 'page' | 'paragraph' | 'selection' | 'timestamp'}
        anchorData={note.anchor_data}
        onSave={handleSave}
        onCancel={() => setIsEditing(false)}
        isLoading={isLoading}
      />
    )
  }

  return (
    <div className="group p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onNavigate(note.anchor_type, note.anchor_data)}
          className="flex-1 text-left"
        >
          <AnchorBadge
            type={note.anchor_type as 'page' | 'paragraph' | 'selection' | 'timestamp'}
            data={note.anchor_data}
            className="mb-2"
          />
          <p className="text-sm line-clamp-3">{note.content}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
          </p>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setIsEditing(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/NoteItem.tsx
git commit -m "feat: add NoteItem component for displaying notes

Shows note content, anchor badge, timestamp, edit/delete menu.
Click to navigate to anchor location. Inline editing support."
```

---

### Task 4.4: Create NotesPanel Component

**Files:**
- Create: `packages/frontend/src/components/documents/NotesPanel.tsx`

**Step 1: Create the component**

```typescript
import { useState, useEffect } from 'react'
import { Plus, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NoteItem } from './NoteItem'
import { NoteEditor } from './NoteEditor'
import { api, Note } from '@/lib/api'

interface NotesPanelProps {
  documentId: string
  currentPage?: number
  currentParagraph?: number
  selectedText?: { text: string; start: number; end: number } | null
  onNavigateToAnchor: (anchorType: string, anchorData: Record<string, unknown>) => void
  onClose?: () => void
}

export function NotesPanel({
  documentId,
  currentPage = 1,
  currentParagraph,
  selectedText,
  onNavigateToAnchor,
  onClose,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Determine anchor for new notes
  const newNoteAnchor = (() => {
    if (selectedText) {
      return {
        type: 'selection' as const,
        data: { text: selectedText.text, start: selectedText.start, end: selectedText.end },
      }
    }
    if (currentParagraph !== undefined) {
      return { type: 'paragraph' as const, data: { paragraph: currentParagraph } }
    }
    return { type: 'page' as const, data: { page: currentPage } }
  })()

  const fetchNotes = async () => {
    try {
      setIsLoading(true)
      const response = await api.notes.list({ document_id: documentId })
      setNotes(response.notes)
      setError(null)
    } catch (e) {
      setError('Failed to load notes')
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchNotes()
  }, [documentId])

  const handleCreate = async (content: string) => {
    try {
      const newNote = await api.notes.create({
        document_id: documentId,
        content,
        anchor_type: newNoteAnchor.type,
        anchor_data: newNoteAnchor.data,
      })
      setNotes((prev) => [newNote, ...prev])
      setIsCreating(false)
    } catch (e) {
      console.error('Failed to create note:', e)
    }
  }

  const handleUpdate = async (noteId: string, content: string) => {
    try {
      const updated = await api.notes.update(noteId, { content })
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)))
    } catch (e) {
      console.error('Failed to update note:', e)
    }
  }

  const handleDelete = async (noteId: string) => {
    try {
      await api.notes.delete(noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch (e) {
      console.error('Failed to delete note:', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="font-medium">Notes</span>
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {notes.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsCreating(true)}
            disabled={isCreating}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {isCreating && (
            <NoteEditor
              anchorType={newNoteAnchor.type}
              anchorData={newNoteAnchor.data}
              onSave={handleCreate}
              onCancel={() => setIsCreating(false)}
            />
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading notes...</p>
          ) : error ? (
            <p className="text-sm text-destructive text-center py-4">{error}</p>
          ) : notes.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No notes yet</p>
              <Button
                variant="link"
                size="sm"
                className="mt-1"
                onClick={() => setIsCreating(true)}
              >
                Add your first note
              </Button>
            </div>
          ) : (
            notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onNavigate={onNavigateToAnchor}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/NotesPanel.tsx
git commit -m "feat: add NotesPanel component for document notes sidebar

Full notes management: list, create, edit, delete.
Auto-detects anchor type from current position/selection.
Navigates to anchor location on click."
```

---

### Task 4.5: Add Notes API Methods to Frontend

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add Note types if not present**

```typescript
export interface Note {
  id: string
  content: string
  recording_id: string | null
  document_id: string | null
  anchor_type: string
  anchor_data: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface NoteListResponse {
  notes: Note[]
}

export interface NoteCreateRequest {
  content: string
  recording_id?: string
  document_id?: string
  anchor_type: string
  anchor_data: Record<string, unknown>
}

export interface NoteUpdateRequest {
  content?: string
  anchor_type?: string
  anchor_data?: Record<string, unknown>
}
```

**Step 2: Add notes API object**

```typescript
notes: {
  list: async (params: { recording_id?: string; document_id?: string }): Promise<NoteListResponse> => {
    const searchParams = new URLSearchParams()
    if (params.recording_id) searchParams.set('recording_id', params.recording_id)
    if (params.document_id) searchParams.set('document_id', params.document_id)
    const response = await fetch(`${API_BASE}/notes?${searchParams}`)
    if (!response.ok) throw new Error('Failed to fetch notes')
    return response.json()
  },

  create: async (data: NoteCreateRequest): Promise<Note> => {
    const response = await fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error('Failed to create note')
    return response.json()
  },

  update: async (noteId: string, data: NoteUpdateRequest): Promise<Note> => {
    const response = await fetch(`${API_BASE}/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error('Failed to update note')
    return response.json()
  },

  delete: async (noteId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/notes/${noteId}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error('Failed to delete note')
  },
},
```

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: add notes API client methods

- notes.list() with recording_id or document_id filter
- notes.create() with anchor type and data
- notes.update() for content/anchor changes
- notes.delete() for removal"
```

---

### Task 4.6: Integrate NotesPanel into DocumentViewerPage

**Files:**
- Modify: `packages/frontend/src/pages/documents/DocumentViewerPage.tsx`

**Step 1: Add imports**

```typescript
import { NotesPanel } from '@/components/documents/NotesPanel'
import { MessageSquare } from 'lucide-react'
```

**Step 2: Add state for notes panel**

```typescript
const [notesOpen, setNotesOpen] = useState(false)
const [currentPage, setCurrentPage] = useState(1)
```

**Step 3: Add navigation handler**

```typescript
const handleNavigateToAnchor = (anchorType: string, anchorData: Record<string, unknown>) => {
  switch (anchorType) {
    case 'page':
      // For PDF/PPTX, navigate to page
      if (anchorData.page) {
        setCurrentPage(anchorData.page as number)
        // If PPTX, also set current slide
        if (doc?.mime_type?.includes('presentation')) {
          setCurrentSlide((anchorData.page as number) - 1)
        }
      }
      break
    case 'paragraph':
      // Scroll to paragraph (would need paragraph refs)
      console.log('Navigate to paragraph:', anchorData.paragraph)
      break
    case 'selection':
      // Highlight selection (future enhancement)
      console.log('Navigate to selection:', anchorData.text)
      break
  }
}
```

**Step 4: Update layout to include notes panel**

Wrap the content area and add the notes panel:

```tsx
<div className="flex flex-1 overflow-hidden">
  {/* Main content area */}
  <div className="flex-1 overflow-auto">
    {renderContent()}
  </div>

  {/* Notes toggle button */}
  <Button
    variant="ghost"
    size="icon"
    className="absolute right-4 top-20 z-10"
    onClick={() => setNotesOpen(!notesOpen)}
  >
    <MessageSquare className="h-5 w-5" />
  </Button>

  {/* Notes panel */}
  {notesOpen && doc && (
    <div className="w-80 border-l border-border flex-shrink-0">
      <NotesPanel
        documentId={doc.id}
        currentPage={currentPage}
        onNavigateToAnchor={handleNavigateToAnchor}
        onClose={() => setNotesOpen(false)}
      />
    </div>
  )}
</div>
```

**Step 5: Verify build**

Run: `cd packages/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add packages/frontend/src/pages/documents/DocumentViewerPage.tsx
git commit -m "feat: integrate NotesPanel into DocumentViewerPage

Collapsible notes sidebar with toggle button.
Supports navigation to page anchors.
Tracks current page for new note creation."
```

---

## Phase 5: Frontend Viewer Enhancements

### Task 5.1: Improve Failed Document Display

**Files:**
- Modify: `packages/frontend/src/pages/documents/DocumentViewerPage.tsx`

**Step 1: Update the failed status display**

Find the section that handles `doc.status === 'failed'` and replace with:

```tsx
{doc.status === 'failed' && (
  <div className="flex items-center justify-center h-full">
    <div className="bg-destructive/10 border border-destructive rounded-lg p-6 max-w-md text-center">
      <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
      <h3 className="font-semibold text-destructive mb-2">Processing Failed</h3>
      <p className="text-sm text-muted-foreground mb-4">
        {doc.error_message || 'An unknown error occurred while processing this document.'}
      </p>
      <Button onClick={handleRetry} disabled={isRetrying}>
        <RefreshCw className={cn('h-4 w-4 mr-2', isRetrying && 'animate-spin')} />
        {isRetrying ? 'Retrying...' : 'Retry Processing'}
      </Button>
    </div>
  </div>
)}
```

**Step 2: Add AlertCircle import**

```typescript
import { AlertCircle, RefreshCw } from 'lucide-react'
```

**Step 3: Add retry state if not present**

```typescript
const [isRetrying, setIsRetrying] = useState(false)

const handleRetry = async () => {
  if (!doc) return
  setIsRetrying(true)
  try {
    await api.documents.reprocess(doc.id)
    // Refetch document to get updated status
    const updated = await api.documents.get(doc.id)
    setDoc(updated)
  } catch (e) {
    console.error('Retry failed:', e)
  } finally {
    setIsRetrying(false)
  }
}
```

**Step 4: Commit**

```bash
git add packages/frontend/src/pages/documents/DocumentViewerPage.tsx
git commit -m "feat: improve failed document UI with clear error message

Shows error message from backend, centered layout with icon,
retry button with loading state."
```

---

### Task 5.2: Add Component Index Exports

**Files:**
- Create: `packages/frontend/src/components/documents/index.ts`

**Step 1: Create barrel export file**

```typescript
export { AnchorBadge } from './AnchorBadge'
export { NoteEditor } from './NoteEditor'
export { NoteItem } from './NoteItem'
export { NotesPanel } from './NotesPanel'
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/documents/index.ts
git commit -m "chore: add barrel exports for document components"
```

---

## Final Verification

### Task 6.1: Build and Verify

**Step 1: Build frontend**

Run: `cd packages/frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 2: Verify backend imports**

Run: `cd packages/backend && python -c "from api.routes.search import router; from api.routes.ai import router; from jobs.process_document import process_document_job; print('All imports OK')"`

**Step 3: Run any existing tests**

Run: `cd packages/backend && python -m pytest tests/ -v --tb=short 2>&1 | tail -20` (if tests exist)

**Step 4: Final commit with summary**

```bash
git add -A
git status
# If any uncommitted changes, commit them

git log --oneline -10  # Review commits
```

---

## Summary

**Commits made:**
1. fix: remove broken PDF preview code
2. fix: use correct embedding service method for documents
3. feat: add OCR availability checks and confidence tracking
4. feat: add semantic search endpoint for documents
5. feat: include documents in global search
6. feat: add document context support to AI chat
7. feat: add document search and chat API methods
8. feat: add AnchorBadge component
9. feat: add NoteEditor component
10. feat: add NoteItem component
11. feat: add NotesPanel component
12. feat: add notes API client methods
13. feat: integrate NotesPanel into DocumentViewerPage
14. feat: improve failed document UI
15. chore: add barrel exports for document components

**Files created:**
- `packages/frontend/src/components/documents/AnchorBadge.tsx`
- `packages/frontend/src/components/documents/NoteEditor.tsx`
- `packages/frontend/src/components/documents/NoteItem.tsx`
- `packages/frontend/src/components/documents/NotesPanel.tsx`
- `packages/frontend/src/components/documents/index.ts`

**Files modified:**
- `packages/backend/jobs/process_document.py`
- `packages/backend/services/document_processor.py`
- `packages/backend/api/routes/search.py`
- `packages/backend/api/routes/ai.py`
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/pages/documents/DocumentViewerPage.tsx`
