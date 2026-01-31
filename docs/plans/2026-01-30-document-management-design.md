# Document Management Feature Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive document management to Verbatim Studio - upload, store, OCR, annotate, and AI-query documents alongside recordings and transcripts.

**Architecture:** Documents stored locally in `media/documents/`, processed via background jobs using Chandra OCR for images/PDFs and python libraries for Office formats. Content embedded for RAG queries alongside transcripts.

**Tech Stack:** Chandra OCR (Qwen3-based), python-docx, openpyxl, python-pptx, react-pdf

---

## 1. Data Model

### Documents Table

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    -- Processing state
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
    error_message TEXT,

    -- Extracted content
    extracted_text TEXT,
    extracted_markdown TEXT,
    page_count INTEGER,

    -- Metadata
    metadata JSON DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_documents_project_id ON documents(project_id);
CREATE INDEX idx_documents_status ON documents(status);
```

### Notes Table

```sql
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,

    -- Polymorphic attachment (one of these set)
    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,

    -- Context anchoring
    anchor_type VARCHAR(20) NOT NULL,  -- timestamp, page, paragraph, selection
    anchor_data JSON NOT NULL,  -- e.g., {"time": 45.2} or {"page": 3, "paragraph": 2}

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT notes_single_parent CHECK (
        (recording_id IS NOT NULL AND document_id IS NULL) OR
        (recording_id IS NULL AND document_id IS NOT NULL)
    )
);

CREATE INDEX idx_notes_recording_id ON notes(recording_id);
CREATE INDEX idx_notes_document_id ON notes(document_id);
```

### Embeddings Table Extension

```sql
ALTER TABLE embeddings ADD COLUMN document_id UUID REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE embeddings ADD COLUMN chunk_metadata JSON;

CREATE INDEX idx_embeddings_document_id ON embeddings(document_id);
```

---

## 2. API Endpoints

### Document CRUD

```
POST   /api/documents              # Upload document (multipart form)
GET    /api/documents              # List documents (?project_id=, ?status=, ?search=)
GET    /api/documents/:id          # Get document details
PATCH  /api/documents/:id          # Update title, project assignment
DELETE /api/documents/:id          # Delete document + file

GET    /api/documents/:id/content  # Get extracted text/markdown
GET    /api/documents/:id/file     # Download original file
POST   /api/documents/:id/process  # Re-trigger OCR/extraction
```

### Notes

```
POST   /api/notes                  # Create note
GET    /api/notes                  # List notes (?recording_id= or ?document_id=)
PATCH  /api/notes/:id              # Update note content
DELETE /api/notes/:id              # Delete note
```

### Project Integration

```
GET    /api/projects/:id/documents           # List documents in project
POST   /api/projects/:id/documents/:docId    # Add document to project
DELETE /api/projects/:id/documents/:docId    # Remove from project
```

---

## 3. Document Processing Pipeline

### Background Job Flow

1. **Upload**: Save file to `media/documents/{uuid}/{filename}`
2. **Create Record**: Document with `status: pending`
3. **Queue Job**: `process_document` job added to queue
4. **Process by Type**:
   - **PDF**: Chandra OCR → markdown + plain text per page
   - **Images** (PNG, JPG, TIFF): Chandra OCR → markdown
   - **DOCX**: `python-docx` → extract paragraphs as text
   - **XLSX**: `openpyxl` → extract sheets as markdown tables
   - **PPTX**: `python-pptx` → extract slide text
   - **TXT/MD**: Direct read
5. **Generate Embeddings**: Chunk text (~500 tokens), embed, store
6. **Update Status**: `status: completed` or `status: failed`

### Chandra OCR Integration

```python
from chandra_ocr import ocr

def process_with_chandra(file_path: str) -> dict:
    result = ocr(file_path, output_format="markdown")
    return {
        "markdown": result.markdown,
        "text": result.plain_text,
        "pages": result.page_count,
        "confidence": result.confidence
    }
```

### Dependencies

```
chandra-ocr>=0.1.0
python-docx>=1.1.0
openpyxl>=3.1.0
python-pptx>=0.6.23
```

---

## 4. Frontend UI

### New Sidebar Item

- "Documents" added below "Search"
- Shows all standalone + project documents

### Documents Page (`/documents`)

- Header: Title + "Upload Document" button
- Filters: Status, search, sort by date
- Grid view with document cards:
  - Thumbnail (PDF first page, image preview, type icon)
  - Title, type badge, status
  - Project link (if assigned)
  - File size, created date
- Click → Document Viewer

### Document Viewer Page (`/documents/:id`)

- **Left panel (70%)**: Content display
  - PDF: Embedded viewer (react-pdf)
  - Images: Zoomable image
  - Office docs: Rendered markdown
- **Right panel (30%)**: Info + Notes
  - Metadata: filename, type, size, pages
  - "View Original" download button
  - Notes list with anchors
  - "Add Note" button

### Project Detail Enhancement

- New "Documents" tab next to "Recordings"
- Same card layout filtered to project
- "Add Document" → upload or select existing

### Notes Slide-out Panel

- Reusable component for Transcript + Document pages
- Slides from right edge
- Shows notes for current context
- Add note form with anchor selector
- Auto-captures timestamp (transcripts) or page (documents)

### Upload Dialog

- Drag-and-drop zone + file picker
- Multi-file support
- Optional project assignment
- Per-file progress bars
- Accepted types: PDF, DOCX, XLSX, PPTX, PNG, JPG, TIFF, TXT, MD

---

## 5. RAG & Search Integration

### Document Embeddings

- Chunk documents into ~500 token segments
- Store in `embeddings` table with `document_id`
- Include `chunk_metadata`: page number, section heading

### AI Chat Enhancements

- Context picker: Select transcripts AND/OR documents
- Document chunks included in semantic search
- Citations show: document name + page number
- System prompt updated to reference document context

### Global Search Extension

- Search results include: Recordings, Transcripts, Documents
- Document results show: title, snippet, page number
- Tabbed or unified results view

### Project-Level Queries

- "Summarize all documents in this project"
- "Compare transcript X with document Y"
- RAG pulls from: transcripts + documents + notes

### Notes in RAG

- Notes embedded and searchable
- Surface as context alongside content chunks

---

## 6. Implementation Phases

### Phase 1: Backend Foundation
- Database migrations
- Document model + CRUD API
- File upload/storage
- Basic text extraction (TXT, MD)

### Phase 2: Office Document Processing
- DOCX extraction
- XLSX extraction → markdown tables
- PPTX extraction
- Background job processing

### Phase 3: OCR with Chandra
- Install/configure chandra-ocr
- PDF processing pipeline
- Image OCR support

### Phase 4: Frontend - Documents UI
- Documents page
- Document Viewer page
- Upload dialog
- Project Documents tab

### Phase 5: Notes System
- Notes API
- Notes slide-out panel
- Transcript page integration
- Document Viewer integration

### Phase 6: RAG & Search
- Document chunking/embedding
- Chat context picker extension
- Global search extension

---

## 7. File Structure

### Backend (new files)

```
packages/backend/
├── api/routes/
│   ├── documents.py          # Document CRUD endpoints
│   └── notes.py              # Notes endpoints
├── models/
│   ├── document.py           # Document SQLAlchemy model
│   └── note.py               # Note SQLAlchemy model
├── services/
│   ├── document_processor.py # Extraction orchestration
│   └── ocr_service.py        # Chandra OCR wrapper
└── jobs/
    └── process_document.py   # Background processing job
```

### Frontend (new files)

```
packages/frontend/src/
├── pages/documents/
│   ├── DocumentsPage.tsx     # Documents list page
│   └── DocumentViewerPage.tsx # Single document view
├── components/documents/
│   ├── DocumentCard.tsx      # Grid card component
│   ├── DocumentList.tsx      # List view component
│   └── UploadDialog.tsx      # Upload modal
└── components/notes/
    ├── NotesPanel.tsx        # Slide-out panel
    ├── NoteItem.tsx          # Individual note
    └── NoteForm.tsx          # Add/edit note form
```

---

## 8. Testing Strategy

### Backend Tests
- Document upload/download
- Text extraction per file type
- OCR processing (mock Chandra for unit tests)
- Notes CRUD with anchoring
- Embedding generation

### Frontend Tests
- Upload flow with progress
- Document viewer rendering
- Notes panel interactions
- Context picker with documents

### Integration Tests
- Full upload → process → embed → search flow
- AI chat with document context
- Project document management
