# File Browser Feature Design

## Summary

Add a filesystem-style browser UI that aggregates all Verbatim content (projects, recordings, documents) into a navigable hierarchy. Projects act as folders, recordings and documents act as files. Standard filesystem operations (copy, move, rename, delete) are supported. Storage locations can be configured for future cloud sync support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        File Browser                          │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │ Folder Tree  │  │ Breadcrumb: My Files / Interviews    │ │
│  │              │  ├──────────────────────────────────────┤ │
│  │ ▼ My Files   │  │ [+ New] [Upload] [⋮]    🔍 Search    │ │
│  │   📁 Interviews│ ├──────────────────────────────────────┤ │
│  │   📁 Projects │  │                                      │ │
│  │   📁 Archive  │  │  📁 Phase 1    🎙️ Call-001   📄 Notes │ │
│  │              │  │  3 items       45:30        2.1 MB   │ │
│  │              │  │                                      │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Model Changes

### 1. Recording-Project Relationship

**Before:** Many-to-many via `project_recordings` junction table
**After:** Simple FK `Recording.project_id`

```python
class Recording(Base):
    # Change from many-to-many to single FK
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    # Track copy lineage
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("recordings.id", ondelete="SET NULL")
    )
    storage_location_id: Mapped[str | None] = mapped_column(
        ForeignKey("storage_locations.id", ondelete="SET NULL")
    )
```

### 2. Document Model Updates

```python
class Document(Base):
    # Already has project_id, add:
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    storage_location_id: Mapped[str | None] = mapped_column(
        ForeignKey("storage_locations.id", ondelete="SET NULL")
    )
```

### 3. New StorageLocation Model

```python
class StorageLocation(Base):
    __tablename__ = "storage_locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # "local", "s3", "azure", "gcs"
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    # Config examples:
    # local: {"path": "/Users/.../Verbatim Studio/media"}
    # s3: {"bucket": "my-bucket", "prefix": "verbatim/", "region": "us-east-1"}
```

### 4. Migration: Recording-Project Junction Table

```python
# Migration steps:
# 1. Add project_id FK to recordings table
# 2. Migrate data: for each recording, pick first project from junction (or null)
# 3. Keep junction table for rollback safety
# 4. Later: drop junction table after verification
```

## API Design

### Browse Endpoint

```python
@router.get("/browse")
async def browse(
    parent_id: str | None = None,  # project_id, null = root
    sort: str = "name",  # name, updated_at, size, type
    order: str = "asc",
    search: str | None = None,
) -> BrowseResponse:
    """List folders and files at the given path."""

class BrowseItem(BaseModel):
    id: str
    type: Literal["folder", "recording", "document"]
    name: str
    updated_at: str
    # Type-specific fields
    item_count: int | None = None  # folders
    status: str | None = None  # recordings
    duration_seconds: float | None = None  # recordings
    mime_type: str | None = None  # documents
    file_size_bytes: int | None = None  # documents

class BrowseResponse(BaseModel):
    current: BrowseItem | None  # null at root
    breadcrumb: list[BrowseItem]
    items: list[BrowseItem]
    total: int
```

### Filesystem Operations

```python
@router.post("/browse/move")
async def move_item(
    item_id: str,
    item_type: Literal["recording", "document"],
    target_project_id: str | None,  # null = move to root
) -> BrowseItem:
    """Move item to target folder."""

@router.post("/browse/copy")
async def copy_item(
    item_id: str,
    item_type: Literal["recording", "document"],
    target_project_id: str | None,
) -> BrowseItem:
    """Copy item to target folder. Creates independent copy with file duplication."""

@router.post("/browse/rename")
async def rename_item(
    item_id: str,
    item_type: Literal["folder", "recording", "document"],
    new_name: str,
) -> BrowseItem:
    """Rename item."""

@router.delete("/browse/{item_type}/{item_id}")
async def delete_item(
    item_type: Literal["folder", "recording", "document"],
    item_id: str,
) -> MessageResponse:
    """Delete item. For folders, must be empty or use recursive=true."""
```

### Folder Tree Endpoint

```python
@router.get("/browse/tree")
async def get_folder_tree() -> FolderTreeResponse:
    """Get all folders as a tree for sidebar navigation."""

class FolderTreeNode(BaseModel):
    id: str
    name: str
    children: list["FolderTreeNode"]
    item_count: int

class FolderTreeResponse(BaseModel):
    root: FolderTreeNode  # Virtual root "My Files"
```

## Copy Operation Detail

When copying a recording:

1. **Create new Recording record**
   - Copy all metadata fields
   - Set `source_id` to original recording ID
   - Set `project_id` to target project
   - Generate new ID
   - Title: "{original title} (Copy)" or let user rename

2. **Copy audio/video file**
   - Duplicate file in storage
   - Update `file_path` to new location

3. **Copy Transcript (if exists)**
   - Create new Transcript record
   - Copy all Segment records with new transcript_id
   - Copy all SegmentEmbedding records with new segment_ids

4. **Copy Notes (if any)**
   - Create copies of Note records attached to recording

```python
async def copy_recording(
    db: AsyncSession,
    recording_id: str,
    target_project_id: str | None,
) -> Recording:
    original = await db.get(Recording, recording_id, options=[
        selectinload(Recording.transcript).selectinload(Transcript.segments),
        selectinload(Recording.notes),
    ])

    new_id = generate_uuid()

    # Copy file
    new_file_path = f"recordings/{new_id}/{original.file_name}"
    original_full_path = storage_service.get_full_path(f"recordings/{original.id}/{original.file_name}")
    await storage_service.copy_file(original_full_path, new_file_path)

    # Create recording copy
    new_recording = Recording(
        id=new_id,
        title=f"{original.title} (Copy)",
        file_path=new_file_path,
        file_name=original.file_name,
        file_size=original.file_size,
        duration_seconds=original.duration_seconds,
        mime_type=original.mime_type,
        metadata_=original.metadata_.copy(),
        status=original.status,
        project_id=target_project_id,
        source_id=original.id,
        template_id=original.template_id,
    )
    db.add(new_recording)

    # Copy transcript if exists
    if original.transcript:
        new_transcript = Transcript(
            id=generate_uuid(),
            recording_id=new_id,
            language=original.transcript.language,
            source=original.transcript.source,
            metadata_=original.transcript.metadata_.copy(),
        )
        db.add(new_transcript)

        # Copy segments
        for seg in original.transcript.segments:
            new_segment = Segment(
                id=generate_uuid(),
                transcript_id=new_transcript.id,
                segment_index=seg.segment_index,
                start_time=seg.start_time,
                end_time=seg.end_time,
                text=seg.text,
                speaker=seg.speaker,
                confidence=seg.confidence,
                metadata_=seg.metadata_.copy(),
            )
            db.add(new_segment)
            # Note: embeddings would need to be regenerated or copied

    # Copy notes
    for note in original.notes:
        new_note = Note(
            id=generate_uuid(),
            recording_id=new_id,
            content=note.content,
            timestamp_seconds=note.timestamp_seconds,
            metadata_=note.metadata_.copy(),
        )
        db.add(new_note)

    await db.commit()
    return new_recording
```

## Frontend Components

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `FileBrowserPage` | `pages/browser/FileBrowserPage.tsx` | Main container |
| `FolderTree` | `components/browser/FolderTree.tsx` | Sidebar folder navigation |
| `FolderTreeNode` | `components/browser/FolderTreeNode.tsx` | Collapsible tree node |
| `Breadcrumb` | `components/browser/Breadcrumb.tsx` | Path navigation |
| `BrowserToolbar` | `components/browser/BrowserToolbar.tsx` | Actions, search, view toggle |
| `BrowserGrid` | `components/browser/BrowserGrid.tsx` | Grid view of items |
| `BrowserList` | `components/browser/BrowserList.tsx` | List/table view of items |
| `BrowserItem` | `components/browser/BrowserItem.tsx` | Single item (polymorphic) |
| `ItemContextMenu` | `components/browser/ItemContextMenu.tsx` | Right-click menu |
| `MoveDialog` | `components/browser/MoveDialog.tsx` | Move/copy destination picker |
| `RenameDialog` | `components/browser/RenameDialog.tsx` | Rename input |
| `NewFolderDialog` | `components/browser/NewFolderDialog.tsx` | Create folder |

### State Management

```typescript
interface BrowserState {
  currentFolderId: string | null;
  breadcrumb: BrowseItem[];
  items: BrowseItem[];
  selectedItems: Set<string>;
  viewMode: 'grid' | 'list';
  sortBy: 'name' | 'updated_at' | 'size' | 'type';
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  folderTree: FolderTreeNode | null;
}
```

### Navigation Integration

```typescript
// App.tsx navigation state
type NavigationState =
  | { type: 'browser'; folderId: string | null }  // NEW
  | { type: 'recordings' }
  | { type: 'documents' }
  | { type: 'projects' }
  // ... existing types

// Sidebar.tsx - add new nav item
{ icon: FolderIcon, label: 'Files', path: 'browser' }
```

## Storage Location UI (Settings)

```
Settings > Storage

┌─────────────────────────────────────────────────────────────┐
│ Storage Locations                                  [+ Add]  │
├─────────────────────────────────────────────────────────────┤
│ ✓ Local Storage (Default)                                   │
│   ~/Library/Application Support/Verbatim Studio/media       │
│   [Set Default] [Edit] [Remove]                             │
├─────────────────────────────────────────────────────────────┤
│ ○ S3 Backup                                                 │
│   s3://my-bucket/verbatim/                                  │
│   [Set Default] [Edit] [Remove]                             │
└─────────────────────────────────────────────────────────────┘
```

## Migration Strategy

### Phase 1: Data Model
1. Add `StorageLocation` model
2. Add `source_id`, `storage_location_id` to Recording
3. Add `source_id`, `storage_location_id` to Document
4. Add `project_id` FK to Recording (alongside junction table)
5. Migrate junction data to FK
6. Create default StorageLocation for existing media

### Phase 2: Backend API
1. Create `/api/browse` endpoint
2. Create `/api/browse/tree` endpoint
3. Create filesystem operation endpoints (move, copy, rename, delete)
4. Add `copy_file` method to storage service

### Phase 3: Frontend
1. Add FileBrowserPage and components
2. Add sidebar navigation item
3. Implement folder tree
4. Implement browse view (grid/list)
5. Implement context menu and dialogs
6. Add storage location settings UI

### Phase 4: Cleanup
1. Deprecate `project_recordings` junction table
2. Update existing pages to use new relationship (if needed)

## Files to Create/Modify

### Create
- `packages/backend/persistence/models.py` - Add StorageLocation
- `packages/backend/api/routes/browse.py` - Browse API
- `packages/backend/services/file_operations.py` - Copy/move logic
- `packages/frontend/src/pages/browser/FileBrowserPage.tsx`
- `packages/frontend/src/components/browser/*.tsx` (10+ components)

### Modify
- `packages/backend/persistence/models.py` - Recording/Document changes
- `packages/backend/services/storage.py` - Add copy_file method
- `packages/backend/api/main.py` - Register browse router
- `packages/frontend/src/lib/api.ts` - Browse API client
- `packages/frontend/src/app/App.tsx` - Navigation
- `packages/frontend/src/components/layout/Sidebar.tsx` - Add Files nav

## Verification

1. **Migration**: Run migration, verify recording-project data preserved
2. **Browse API**: Can list items at root and within folders
3. **Tree API**: Returns correct folder hierarchy
4. **Move**: Recording moves to new folder, updates in DB
5. **Copy**: Creates independent copy with duplicated file and transcript
6. **Rename**: Updates title correctly
7. **Delete**: Removes item and associated files
8. **UI**: Can navigate folders, select items, perform operations
