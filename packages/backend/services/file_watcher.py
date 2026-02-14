"""File watcher service for detecting external file changes.

Monitors the storage location for files added/removed/moved externally
and synchronizes the database accordingly.
"""

import asyncio
import logging
import mimetypes
from pathlib import Path
from threading import Lock
from typing import Callable

from watchdog.events import (
    DirCreatedEvent,
    DirDeletedEvent,
    DirMovedEvent,
    FileCreatedEvent,
    FileDeletedEvent,
    FileMovedEvent,
    FileSystemEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

# File types we can handle
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".webm"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".webp"}

ALL_SUPPORTED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS | DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS


class VerbatimFileHandler(FileSystemEventHandler):
    """Handle filesystem events and sync with database.

    This handler is called from the watchdog observer thread.
    Database operations are scheduled on the asyncio event loop.
    """

    def __init__(
        self,
        storage_root: Path,
        event_loop: asyncio.AbstractEventLoop,
        on_file_created: Callable[[Path], None] | None = None,
        on_file_deleted: Callable[[Path], None] | None = None,
        on_file_moved: Callable[[Path, Path], None] | None = None,
        on_folder_created: Callable[[Path], None] | None = None,
        on_folder_deleted: Callable[[Path], None] | None = None,
        on_folder_moved: Callable[[Path, Path], None] | None = None,
    ):
        """Initialize the handler.

        Args:
            storage_root: The storage location root directory.
            event_loop: The asyncio event loop for scheduling async operations.
            on_file_created: Callback when a file is created externally.
            on_file_deleted: Callback when a file is deleted externally.
            on_file_moved: Callback when a file is moved externally.
            on_folder_created: Callback when a folder is created externally.
            on_folder_deleted: Callback when a folder is deleted externally.
            on_folder_moved: Callback when a folder is moved externally.
        """
        self.storage_root = storage_root.resolve()
        self._loop = event_loop
        self._on_file_created = on_file_created
        self._on_file_deleted = on_file_deleted
        self._on_file_moved = on_file_moved
        self._on_folder_created = on_folder_created
        self._on_folder_deleted = on_folder_deleted
        self._on_folder_moved = on_folder_moved

        # Files we're currently writing (to ignore our own events)
        self._internal_files: set[Path] = set()
        self._lock = Lock()

        # Debounce timers for file creation (wait for file to be fully written)
        self._debounce_timers: dict[str, asyncio.TimerHandle] = {}
        self._debounce_delay = 2.0  # seconds

    def mark_internal(self, path: Path) -> None:
        """Mark a path as being written by the app (ignore watcher events)."""
        with self._lock:
            self._internal_files.add(path.resolve())

    def unmark_internal(self, path: Path) -> None:
        """Remove a path from the internal set."""
        with self._lock:
            self._internal_files.discard(path.resolve())

    def _is_internal(self, path: Path) -> bool:
        """Check if this path is being written by the app."""
        with self._lock:
            return path.resolve() in self._internal_files

    def _is_supported_file(self, path: Path) -> bool:
        """Check if this file type is supported."""
        return path.suffix.lower() in ALL_SUPPORTED_EXTENSIONS

    def _is_in_storage(self, path: Path) -> bool:
        """Check if path is within storage root."""
        try:
            path.resolve().relative_to(self.storage_root)
            return True
        except ValueError:
            return False

    def _schedule_callback(self, coro) -> None:
        """Schedule an async callback on the event loop."""
        asyncio.run_coroutine_threadsafe(coro, self._loop)

    def _debounce_file_created(self, path: Path) -> None:
        """Debounce file creation to wait for file to be fully written."""
        key = str(path)

        # Cancel existing timer
        if key in self._debounce_timers:
            self._debounce_timers[key].cancel()

        # Schedule new timer
        def fire():
            del self._debounce_timers[key]
            if self._on_file_created and path.exists():
                self._on_file_created(path)

        self._debounce_timers[key] = self._loop.call_later(self._debounce_delay, fire)

    def on_created(self, event: FileSystemEvent) -> None:
        """Handle file/folder creation."""
        path = Path(event.src_path)

        if not self._is_in_storage(path):
            return

        if self._is_internal(path):
            return

        if event.is_directory:
            if self._on_folder_created:
                self._on_folder_created(path)
        elif self._is_supported_file(path):
            # Debounce to wait for file to be fully written
            self._loop.call_soon_threadsafe(self._debounce_file_created, path)

    def on_deleted(self, event: FileSystemEvent) -> None:
        """Handle file/folder deletion."""
        path = Path(event.src_path)

        if not self._is_in_storage(path):
            return

        if event.is_directory:
            if self._on_folder_deleted:
                self._on_folder_deleted(path)
        elif self._is_supported_file(path):
            if self._on_file_deleted:
                self._on_file_deleted(path)

    def on_moved(self, event: FileSystemEvent) -> None:
        """Handle file/folder move/rename."""
        if not isinstance(event, (FileMovedEvent, DirMovedEvent)):
            return

        src_path = Path(event.src_path)
        dest_path = Path(event.dest_path)

        # Check if at least one path is in storage
        src_in = self._is_in_storage(src_path)
        dest_in = self._is_in_storage(dest_path)

        if not src_in and not dest_in:
            return

        if event.is_directory:
            if self._on_folder_moved:
                self._on_folder_moved(src_path, dest_path)
        elif self._is_supported_file(src_path) or self._is_supported_file(dest_path):
            if self._on_file_moved:
                self._on_file_moved(src_path, dest_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        """Handle file modification (reset debounce timer for ongoing writes)."""
        if event.is_directory:
            return

        path = Path(event.src_path)
        key = str(path)

        # If we have a pending creation timer, reset it
        if key in self._debounce_timers:
            self._loop.call_soon_threadsafe(self._debounce_file_created, path)


class FileWatcherService:
    """Service that monitors the storage location for external changes.

    Detects files added/removed/moved externally and creates/updates/deletes
    corresponding database records.
    """

    def __init__(self, storage_root: Path | None = None):
        """Initialize the file watcher service.

        Args:
            storage_root: The storage location to monitor. Uses settings.MEDIA_DIR by default.
        """
        from core.config import settings

        self.storage_root = (storage_root or settings.MEDIA_DIR).resolve()
        self._observer: Observer | None = None
        self._handler: VerbatimFileHandler | None = None
        self._running = False

    def start(self) -> None:
        """Start watching the storage location."""
        if self._running:
            logger.warning("File watcher already running")
            return

        if not self.storage_root.exists():
            logger.warning(f"Storage root does not exist: {self.storage_root}")
            return

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning("No running event loop, file watcher not started")
            return

        self._handler = VerbatimFileHandler(
            storage_root=self.storage_root,
            event_loop=loop,
            on_file_created=self._handle_file_created,
            on_file_deleted=self._handle_file_deleted,
            on_file_moved=self._handle_file_moved,
            on_folder_created=self._handle_folder_created,
            on_folder_deleted=self._handle_folder_deleted,
            on_folder_moved=self._handle_folder_moved,
        )

        self._observer = Observer()
        self._observer.schedule(self._handler, str(self.storage_root), recursive=True)
        self._observer.start()
        self._running = True

        logger.info(f"File watcher started for {self.storage_root}")

    def stop(self) -> None:
        """Stop watching the storage location."""
        if not self._running:
            return

        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5.0)
            self._observer = None

        self._handler = None
        self._running = False

        logger.info("File watcher stopped")

    def mark_internal(self, path: Path) -> None:
        """Mark a path as being written by the app (ignore watcher events)."""
        if self._handler:
            self._handler.mark_internal(path)

    def unmark_internal(self, path: Path) -> None:
        """Remove a path from the internal set."""
        if self._handler:
            self._handler.unmark_internal(path)

    def _get_project_from_path(self, file_path: Path) -> tuple[str | None, str]:
        """Extract project name and filename from a file path.

        Args:
            file_path: The file path relative to storage root.

        Returns:
            Tuple of (project_name or None, filename).
        """
        try:
            relative = file_path.relative_to(self.storage_root)
            parts = relative.parts

            if len(parts) == 1:
                # File at root, no project
                return None, parts[0]
            else:
                # File in project folder
                return parts[0], parts[-1]
        except ValueError:
            return None, file_path.name

    def _handle_file_created(self, path: Path) -> None:
        """Handle external file creation - create DB record."""
        asyncio.create_task(self._async_handle_file_created(path))

    async def _async_handle_file_created(self, path: Path) -> None:
        """Async handler for file creation."""
        from persistence.database import get_session_factory
        from persistence.models import Document, Project, Recording, generate_uuid

        project_name, filename = self._get_project_from_path(path)
        ext = path.suffix.lower()

        # Find project by name
        project_id = None
        if project_name:
            async with get_session_factory()() as session:
                from sqlalchemy import func, select
                result = await session.execute(
                    select(Project).where(func.lower(Project.name) == project_name.lower())
                )
                project = result.scalar_one_or_none()
                if project:
                    project_id = project.id

        # Determine if audio/video or document
        if ext in AUDIO_EXTENSIONS | VIDEO_EXTENSIONS:
            await self._create_recording_record(path, project_id)
        elif ext in DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS:
            await self._create_document_record(path, project_id)

    async def _create_recording_record(self, path: Path, project_id: str | None) -> None:
        """Create a Recording record for an externally added file."""
        from persistence.database import get_session_factory
        from persistence.models import Recording

        # Get file info
        try:
            stat = path.stat()
            file_size = stat.st_size
        except OSError:
            logger.warning(f"Could not stat file: {path}")
            return

        mime_type, _ = mimetypes.guess_type(path.name)
        title = path.stem

        async with get_session_factory()() as session:
            # Check if recording already exists for this path
            from sqlalchemy import select
            result = await session.execute(
                select(Recording).where(Recording.file_path == str(path))
            )
            if result.scalar_one_or_none():
                logger.debug(f"Recording already exists for {path}")
                return

            recording = Recording(
                title=title,
                file_path=str(path),
                file_name=path.name,
                file_size=file_size,
                mime_type=mime_type,
                project_id=project_id,
                status="pending",
                metadata_={"source": "file_watcher"},
            )
            session.add(recording)
            await session.commit()

            logger.info(f"Created recording from external file: {path.name}")

    async def _create_document_record(self, path: Path, project_id: str | None) -> None:
        """Create a Document record for an externally added file."""
        from persistence.database import get_session_factory
        from persistence.models import Document

        # Get file info
        try:
            stat = path.stat()
            file_size = stat.st_size
        except OSError:
            logger.warning(f"Could not stat file: {path}")
            return

        mime_type, _ = mimetypes.guess_type(path.name)
        title = path.stem

        async with get_session_factory()() as session:
            # Check if document already exists for this path
            from sqlalchemy import select
            result = await session.execute(
                select(Document).where(Document.file_path == str(path))
            )
            if result.scalar_one_or_none():
                logger.debug(f"Document already exists for {path}")
                return

            document = Document(
                title=title,
                filename=path.name,
                file_path=str(path),
                mime_type=mime_type or "application/octet-stream",
                file_size_bytes=file_size,
                project_id=project_id,
                status="pending",
                metadata_={"source": "file_watcher"},
            )
            session.add(document)
            await session.commit()

            # Queue processing job
            from services.jobs import job_queue
            await job_queue.enqueue("process_document", {"document_id": document.id})

            logger.info(f"Created document from external file: {path.name}")

    def _handle_file_deleted(self, path: Path) -> None:
        """Handle external file deletion - mark DB record as orphaned."""
        asyncio.create_task(self._async_handle_file_deleted(path))

    async def _async_handle_file_deleted(self, path: Path) -> None:
        """Async handler for file deletion."""
        from persistence.database import get_session_factory
        from persistence.models import Document, Recording
        from sqlalchemy import select

        async with get_session_factory()() as session:
            # Check recordings
            result = await session.execute(
                select(Recording).where(Recording.file_path == str(path))
            )
            recording = result.scalar_one_or_none()
            if recording:
                # Mark as orphaned in metadata
                recording.metadata_ = {**(recording.metadata_ or {}), "orphaned": True}
                recording.status = "failed"
                await session.commit()
                logger.info(f"Marked recording as orphaned: {path.name}")
                return

            # Check documents
            result = await session.execute(
                select(Document).where(Document.file_path == str(path))
            )
            document = result.scalar_one_or_none()
            if document:
                document.metadata_ = {**(document.metadata_ or {}), "orphaned": True}
                document.status = "failed"
                await session.commit()
                logger.info(f"Marked document as orphaned: {path.name}")

    def _handle_file_moved(self, src_path: Path, dest_path: Path) -> None:
        """Handle external file move - update DB record path and project."""
        asyncio.create_task(self._async_handle_file_moved(src_path, dest_path))

    async def _async_handle_file_moved(self, src_path: Path, dest_path: Path) -> None:
        """Async handler for file move."""
        from persistence.database import get_session_factory
        from persistence.models import Document, Project, Recording
        from sqlalchemy import func, select

        # Determine new project from destination path
        new_project_name, _ = self._get_project_from_path(dest_path)
        new_project_id = None

        if new_project_name:
            async with get_session_factory()() as session:
                result = await session.execute(
                    select(Project).where(func.lower(Project.name) == new_project_name.lower())
                )
                project = result.scalar_one_or_none()
                if project:
                    new_project_id = project.id

        async with get_session_factory()() as session:
            # Check recordings
            result = await session.execute(
                select(Recording).where(Recording.file_path == str(src_path))
            )
            recording = result.scalar_one_or_none()
            if recording:
                recording.file_path = str(dest_path)
                recording.file_name = dest_path.name
                recording.title = dest_path.stem
                recording.project_id = new_project_id
                await session.commit()
                logger.info(f"Updated recording path: {src_path.name} -> {dest_path.name}")
                return

            # Check documents
            result = await session.execute(
                select(Document).where(Document.file_path == str(src_path))
            )
            document = result.scalar_one_or_none()
            if document:
                document.file_path = str(dest_path)
                document.filename = dest_path.name
                document.title = dest_path.stem
                document.project_id = new_project_id
                await session.commit()
                logger.info(f"Updated document path: {src_path.name} -> {dest_path.name}")

    def _handle_folder_created(self, path: Path) -> None:
        """Handle external folder creation - potentially create project."""
        asyncio.create_task(self._async_handle_folder_created(path))

    async def _async_handle_folder_created(self, path: Path) -> None:
        """Async handler for folder creation."""
        # Only handle top-level folders (projects)
        try:
            relative = path.relative_to(self.storage_root)
            if len(relative.parts) != 1:
                return  # Not a direct child of storage root
        except ValueError:
            return

        folder_name = path.name

        # Check if project already exists
        from persistence.database import get_session_factory
        from persistence.models import Project
        from sqlalchemy import func, select

        async with get_session_factory()() as session:
            result = await session.execute(
                select(Project).where(func.lower(Project.name) == folder_name.lower())
            )
            if result.scalar_one_or_none():
                logger.debug(f"Project already exists for folder: {folder_name}")
                return

            # Create project
            project = Project(
                name=folder_name,
                metadata_={"source": "file_watcher"},
            )
            session.add(project)
            await session.commit()

            logger.info(f"Created project from external folder: {folder_name}")

    def _handle_folder_deleted(self, path: Path) -> None:
        """Handle external folder deletion."""
        # We don't auto-delete projects when folders are deleted
        # Files inside will trigger individual deletion events
        logger.debug(f"Folder deleted: {path}")

    def _handle_folder_moved(self, src_path: Path, dest_path: Path) -> None:
        """Handle external folder move/rename - potentially rename project."""
        asyncio.create_task(self._async_handle_folder_moved(src_path, dest_path))

    async def _async_handle_folder_moved(self, src_path: Path, dest_path: Path) -> None:
        """Async handler for folder move."""
        # Only handle top-level folders (projects)
        try:
            src_relative = src_path.relative_to(self.storage_root)
            dest_relative = dest_path.relative_to(self.storage_root)
            if len(src_relative.parts) != 1 or len(dest_relative.parts) != 1:
                return  # Not direct children of storage root
        except ValueError:
            return

        old_name = src_path.name
        new_name = dest_path.name

        from persistence.database import get_session_factory
        from persistence.models import Document, Project, Recording
        from sqlalchemy import func, select

        async with get_session_factory()() as session:
            result = await session.execute(
                select(Project).where(func.lower(Project.name) == old_name.lower())
            )
            project = result.scalar_one_or_none()
            if not project:
                logger.debug(f"No project found for renamed folder: {old_name}")
                return

            project.name = new_name

            # Update all file paths for items in this project
            rec_result = await session.execute(
                select(Recording).where(Recording.project_id == project.id)
            )
            for rec in rec_result.scalars():
                if rec.file_path:
                    old_file = Path(rec.file_path)
                    new_file = dest_path / old_file.name
                    rec.file_path = str(new_file)

            doc_result = await session.execute(
                select(Document).where(Document.project_id == project.id)
            )
            for doc in doc_result.scalars():
                if doc.file_path:
                    old_file = Path(doc.file_path)
                    new_file = dest_path / old_file.name
                    doc.file_path = str(new_file)

            await session.commit()
            logger.info(f"Renamed project from external folder rename: {old_name} -> {new_name}")


# Default instance (not started)
file_watcher: FileWatcherService | None = None
