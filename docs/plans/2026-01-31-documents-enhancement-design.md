# Documents Enhancement Design

## Summary

Complete the Documents feature (#40) by implementing Notes UI, Document RAG integration, OCR improvements, and Frontend Viewer enhancements. This builds on the existing document upload, storage, and processing infrastructure.

## Scope

### In Scope
1. **Bug Fixes** - Remove broken PDF preview code, fix embedding generation
2. **Notes UI** - Sidebar panel for creating/viewing contextual notes on documents
3. **Document RAG** - Semantic search across documents, document context in AI chat
4. **OCR Improvements** - Availability checks, confidence tracking, better error handling
5. **Frontend Viewer** - Notes panel integration, position tracking, retry UI

### Out of Scope
- Inline document annotations (see issue #81)
- Cloud storage provider adapters (separate feature)
- Real-time collaboration on notes

---

## 1. Bug Fixes

### 1.1 Remove PDF Preview Code

The `convert_to_pdf()` method was never implemented and isn't needed since the frontend renders Office documents natively.

**Files to modify:**
- `packages/backend/jobs/process_document.py`
  - Remove `OFFICE_MIME_TYPES` import (line 11)
  - Remove `_convert_to_pdf_preview()` function (lines 74-94)
  - Remove the call to it (lines 55-56)

### 1.2 Fix Embedding Generation

**File:** `packages/backend/jobs/process_document.py`

Change from individual embedding calls to batched:

```python
# Before (broken - embed() doesn't exist):
embedding_vector = embedding_service.embed(chunk["text"])

# After (batched for efficiency):
chunk_texts = [chunk["text"] for chunk in chunks]
embeddings = embedding_service.embed_texts(chunk_texts)

for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
    doc_embedding = DocumentEmbedding(
        document_id=doc.id,
        chunk_index=i,
        chunk_text=chunk["text"],
        embedding=embedding_service.embedding_to_bytes(embedding),
        model_used=embedding_service.model_name,
    )
    db.add(doc_embedding)
```

---

## 2. Notes UI (Sidebar Panel)

### 2.1 Component Structure

```
DocumentViewerPage.tsx
├── DocumentContent (existing - left/center)
└── NotesPanel (new - right sidebar, collapsible)
    ├── NotesPanelHeader
    │   ├── Title + count badge
    │   └── Add Note button
    ├── NotesList
    │   └── NoteItem (repeated)
    │       ├── Anchor indicator (page/paragraph icon)
    │       ├── Content preview
    │       ├── Timestamp
    │       └── Actions (edit/delete)
    └── NoteEditor (inline)
        ├── Content textarea
        ├── Anchor display (auto-captured)
        └── Save/Cancel buttons
```

### 2.2 Anchor Types & Behavior

| Anchor Type | When Used | Data Stored | Navigation Action |
|-------------|-----------|-------------|-------------------|
| `page` | PDF, PPTX | `{page: 3}` | Scroll to page / Go to slide |
| `paragraph` | DOCX, Text, Markdown | `{paragraph: 5}` | Scroll to paragraph |
| `selection` | Any text content | `{start: 100, end: 150, text: "..."}` | Highlight text range |

### 2.3 State Management

```typescript
// New state in DocumentViewerPage
const [notesOpen, setNotesOpen] = useState(true)
const [notes, setNotes] = useState<Note[]>([])
const [editingNote, setEditingNote] = useState<Note | null>(null)

// Track current position for new notes
const [currentPage, setCurrentPage] = useState(1)  // PDF/PPTX
const [selectedText, setSelectedText] = useState<Selection | null>(null)
```

### 2.4 API Integration

Uses existing endpoints from `api/routes/notes.py`:
- `GET /notes?document_id={id}` - Load notes on mount
- `POST /notes` - Create note with anchor
- `PATCH /notes/{id}` - Update note content
- `DELETE /notes/{id}` - Delete note

### 2.5 New Components

| Component | File | Purpose |
|-----------|------|---------|
| `NotesPanel` | `components/documents/NotesPanel.tsx` | Main sidebar container |
| `NoteItem` | `components/documents/NoteItem.tsx` | Individual note display |
| `NoteEditor` | `components/documents/NoteEditor.tsx` | Create/edit form |
| `AnchorBadge` | `components/documents/AnchorBadge.tsx` | Anchor type icon + value |

---

## 3. Document RAG Integration

### 3.1 Document Search Endpoint

**New endpoint:** `GET /search/documents`

```python
@router.get("/documents")
async def search_documents(
    db: AsyncSession,
    query: str,
    project_id: str | None = None,
    limit: int = 20,
) -> DocumentSearchResponse:
    """Semantic search across document content."""

    # 1. Embed the query
    query_embedding = await embedding_service.embed_query(query)

    # 2. Fetch document embeddings (with optional project filter)
    stmt = select(DocumentEmbedding).join(Document)
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)

    # 3. Compute cosine similarity in-memory
    # 4. Return top matches with document context
```

**Response models:**

```python
class DocumentSearchResult(BaseModel):
    document_id: str
    document_title: str
    chunk_text: str
    chunk_index: int
    similarity: float
    page: int | None

class DocumentSearchResponse(BaseModel):
    results: list[DocumentSearchResult]
    total: int
```

### 3.2 Update Global Search

**File:** `packages/backend/api/routes/search.py`

Update `GET /search/global` to include documents:
- Add document title matches (keyword search)
- Add document chunk matches (semantic search)
- Return unified results with `type` field: `"recording" | "document" | "segment"`

### 3.3 Document Context in AI Chat

**File:** `packages/backend/api/routes/ai.py`

Update `POST /ai/chat/multi` request model:

```python
class MultiChatRequest(BaseModel):
    recording_ids: list[str] = []
    document_ids: list[str] = []  # NEW
    message: str
```

Context building logic:
1. Fetch transcripts for recordings (existing)
2. Fetch `extracted_markdown` for documents (new)
3. Label each source: "Recording A:", "Document B:", etc.
4. Combine into system context

### 3.4 Frontend API Client

**File:** `packages/frontend/src/lib/api.ts`

Add new methods:
```typescript
search: {
  // existing...
  documents: (query: string, projectId?: string) => Promise<DocumentSearchResponse>
}

ai: {
  // Update chatMulti to accept documentIds
  chatMulti: (recordingIds: string[], documentIds: string[], message: string) => Promise<ChatResponse>
}
```

---

## 4. OCR Improvements

### 4.1 Availability Check

**File:** `packages/backend/services/document_processor.py`

Add module-level check to avoid repeated import attempts:

```python
def _check_chandra_available() -> bool:
    try:
        from chandra_ocr import ocr
        return True
    except ImportError:
        return False

CHANDRA_AVAILABLE = _check_chandra_available()

def _check_pymupdf_available() -> bool:
    try:
        import fitz
        return True
    except ImportError:
        return False

PYMUPDF_AVAILABLE = _check_pymupdf_available()
```

### 4.2 Confidence Tracking

Store OCR quality metrics in document metadata:

```python
metadata = {
    "ocr_engine": "chandra",
    "ocr_confidence": result.confidence if hasattr(result, 'confidence') else None,
    "ocr_page_confidences": [...],  # Per-page if available
}
```

### 4.3 Improved Error Messages

Add user-friendly error messages for common failures:

| Error Condition | Message |
|-----------------|---------|
| No OCR engine | "OCR unavailable - text extraction limited to Office documents" |
| Password-protected PDF | "PDF is password-protected and cannot be processed" |
| Low quality image | "Image quality too low for reliable text extraction" |
| Corrupted file | "File appears to be corrupted or incomplete" |

### 4.4 Processing Logging

Add clear logging for debugging:

```python
logger.info(f"Processing {file_path.name} ({mime_type}) with {engine_name}")
logger.info(f"Extracted {len(text)} chars from {page_count} pages")
```

---

## 5. Frontend Viewer Enhancements

### 5.1 Layout Change

**File:** `packages/frontend/src/pages/documents/DocumentViewerPage.tsx`

Split view with collapsible notes panel:

```tsx
<div className="flex h-full">
  {/* Main content */}
  <div className="flex-1 overflow-auto">
    {renderContent()}
  </div>

  {/* Notes panel toggle button (always visible) */}
  <Button
    variant="ghost"
    size="icon"
    onClick={() => setNotesOpen(!notesOpen)}
  >
    <MessageSquare />
  </Button>

  {/* Collapsible notes panel */}
  {notesOpen && (
    <div className="w-80 border-l border-border">
      <NotesPanel documentId={documentId} />
    </div>
  )}
</div>
```

### 5.2 Position Tracking

Track current viewing position for anchor creation:

| File Type | Method |
|-----------|--------|
| PDF | Page number from scroll position or user input |
| PPTX | Current slide index (already tracked) |
| DOCX/Text/Markdown | Paragraph index from scroll position |
| XLSX | Current sheet name |

### 5.3 Text Selection

Add selection detection for creating selection-anchored notes:

```tsx
const handleTextSelection = useCallback(() => {
  const selection = window.getSelection()
  if (selection && selection.toString().trim().length > 0) {
    setSelectedText({
      text: selection.toString().substring(0, 200),
      range: selection.getRangeAt(0),
    })
  }
}, [])
```

### 5.4 Retry UI Enhancement

Improve failed document display:

```tsx
{doc.status === 'failed' && (
  <div className="bg-destructive/10 border border-destructive rounded-lg p-4 m-4">
    <div className="flex items-center gap-2">
      <AlertCircle className="h-5 w-5 text-destructive" />
      <span className="font-medium text-destructive">Processing Failed</span>
    </div>
    <p className="text-sm text-muted-foreground mt-2">
      {doc.error_message || 'An unknown error occurred'}
    </p>
    <Button onClick={handleRetry} variant="outline" className="mt-3">
      <RefreshCw className="h-4 w-4 mr-2" />
      Retry Processing
    </Button>
  </div>
)}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/frontend/src/components/documents/NotesPanel.tsx` | Notes sidebar |
| `packages/frontend/src/components/documents/NoteItem.tsx` | Note display |
| `packages/frontend/src/components/documents/NoteEditor.tsx` | Note form |
| `packages/frontend/src/components/documents/AnchorBadge.tsx` | Anchor indicator |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/jobs/process_document.py` | Remove PDF preview, fix embeddings |
| `packages/backend/services/document_processor.py` | OCR improvements |
| `packages/backend/api/routes/search.py` | Add document search |
| `packages/backend/api/routes/ai.py` | Add document context to chat |
| `packages/frontend/src/pages/documents/DocumentViewerPage.tsx` | Notes panel, retry UI |
| `packages/frontend/src/lib/api.ts` | New API methods |

---

## Implementation Order

1. **Bug Fixes** - Unblock document processing
2. **OCR Improvements** - Better reliability and error handling
3. **Document RAG** - Backend search and chat integration
4. **Notes UI** - Frontend components and integration
5. **Frontend Viewer** - Polish and enhancements

## Verification

1. Upload a PDF → processing completes without errors
2. Upload a DOCX → text extracted, embeddings generated
3. Search for document content → semantic results returned
4. AI chat with document context → document content included
5. Create note on document → note saved with anchor
6. Click note → navigates to correct position
7. Failed document → shows error message with retry button
