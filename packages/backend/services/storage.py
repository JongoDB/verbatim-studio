"""Storage service for file management.

Implements filesystem-as-UI pattern where:
- Projects are folders on disk
- Recordings/documents are files in those folders
- Files without a project live at the storage root
"""

from pathlib import Path

import aiofiles
import aiofiles.os

from core.config import settings
from services.path_manager import PathManager, path_manager as default_path_manager


class StorageService:
    """Service for managing file storage operations.

    Uses human-readable paths based on project names and item titles.
    """

    def __init__(
        self,
        media_dir: Path | None = None,
        pm: PathManager | None = None,
    ):
        """Initialize storage service.

        Args:
            media_dir: Override for media directory. Uses settings.MEDIA_DIR by default.
            pm: PathManager instance. Uses default if not provided.
        """
        self.media_dir = media_dir or settings.MEDIA_DIR
        self._pm = pm or default_path_manager

    def get_item_path(
        self,
        title: str,
        filename: str,
        project_name: str | None = None,
    ) -> Path:
        """Get the path for a recording or document file.

        New pattern: <project_name>/<title>.<ext> or <title>.<ext>

        Args:
            title: The item title.
            filename: Original filename (used for extension).
            project_name: Project name if item belongs to a project.

        Returns:
            Full path where the file should be stored.
        """
        extension = Path(filename).suffix
        return self._pm.get_item_path(self.media_dir, project_name, title, extension)

    # Legacy method for backwards compatibility during migration
    def get_recording_path(self, recording_id: str, filename: str) -> Path:
        """Get the full path for a recording file (legacy UUID-based path).

        Args:
            recording_id: The recording's unique ID.
            filename: Original filename with extension.

        Returns:
            Full path where the recording file should be stored.

        Raises:
            ValueError: If filename contains path traversal attempts.
        """
        # Defense in depth: sanitize filename to prevent path traversal
        normalized_filename = filename.replace("\\", "/")
        safe_filename = Path(normalized_filename).name
        if not safe_filename or safe_filename in (".", ".."):
            safe_filename = "unknown"

        # Also sanitize recording_id to prevent path traversal
        normalized_recording_id = recording_id.replace("\\", "/")
        safe_recording_id = Path(normalized_recording_id).name
        if not safe_recording_id or safe_recording_id in (".", ".."):
            raise ValueError("Invalid recording ID")

        # Create a subdirectory based on recording ID
        recording_dir = self.media_dir / "recordings" / safe_recording_id
        result_path = recording_dir / safe_filename

        # Final safety check
        try:
            result_path.resolve().relative_to(self.media_dir.resolve())
        except ValueError:
            raise ValueError("Path traversal detected in filename or recording_id")

        return result_path

    async def save_upload(
        self,
        content: bytes,
        title: str,
        filename: str,
        project_name: str | None = None,
    ) -> Path:
        """Save an uploaded file to storage with human-readable path.

        Args:
            content: File content as bytes.
            title: The item title (used for filename).
            filename: Original filename (used for extension).
            project_name: Project name if item belongs to a project.

        Returns:
            Path where the file was saved.
        """
        desired_path = self.get_item_path(title, filename, project_name)

        # Ensure parent directory exists
        await aiofiles.os.makedirs(desired_path.parent, exist_ok=True)

        # Generate unique path to handle collisions
        actual_path = self._pm.generate_unique_path(desired_path.parent, desired_path.name)

        # Ensure directory exists (in case unique path has different parent)
        await aiofiles.os.makedirs(actual_path.parent, exist_ok=True)

        # Write the file
        async with aiofiles.open(actual_path, "wb") as f:
            await f.write(content)

        return actual_path

    async def move_to_project(
        self,
        current_path: Path,
        new_project_name: str | None,
    ) -> Path:
        """Move a file when project assignment changes.

        Args:
            current_path: Current file path.
            new_project_name: New project name, or None to move to root.

        Returns:
            New path where the file is now located.
        """
        if new_project_name:
            new_parent = self.media_dir / self._pm.sanitize_name(new_project_name)
        else:
            new_parent = self.media_dir

        return await self._pm.move_file(current_path, new_parent)

    async def rename_item(self, current_path: Path, new_title: str) -> Path:
        """Rename a file when its title changes.

        Args:
            current_path: Current file path.
            new_title: New title for the item.

        Returns:
            New path with renamed file.
        """
        extension = current_path.suffix
        new_name = f"{self._pm.sanitize_name(new_title)}{extension}"
        return await self._pm.rename_file(current_path, new_name)

    async def delete_file(self, file_path: Path | str) -> bool:
        """Delete a file from storage.

        Args:
            file_path: Path to the file to delete.

        Returns:
            True if file was deleted, False if it didn't exist.
        """
        path = Path(file_path)

        try:
            await aiofiles.os.remove(path)
            # Try to remove parent directory if empty (cleanup project folder)
            await self._pm.delete_folder_if_empty(path.parent)
            return True
        except FileNotFoundError:
            return False

    async def get_file_size(self, file_path: Path | str) -> int | None:
        """Get the size of a file in bytes.

        Args:
            file_path: Path to the file.

        Returns:
            File size in bytes, or None if file doesn't exist.
        """
        path = Path(file_path)

        try:
            stat_result = await aiofiles.os.stat(path)
            return stat_result.st_size
        except FileNotFoundError:
            return None

    async def file_exists(self, file_path: Path | str) -> bool:
        """Check if a file exists.

        Args:
            file_path: Path to the file.

        Returns:
            True if file exists, False otherwise.
        """
        path = Path(file_path)
        return await aiofiles.os.path.exists(path)

    async def save_file(self, relative_path: str, content: bytes) -> Path:
        """Save a file to a relative path under media directory.

        Args:
            relative_path: Relative path like "documents/{id}/{filename}"
            content: File content as bytes.

        Returns:
            Full path where the file was saved.
        """
        # Sanitize path to prevent traversal
        parts = relative_path.replace("\\", "/").split("/")
        safe_parts = []
        for part in parts:
            safe_part = Path(part).name
            if safe_part and safe_part not in (".", ".."):
                safe_parts.append(safe_part)

        if not safe_parts:
            raise ValueError("Invalid file path")

        file_path = self.media_dir.joinpath(*safe_parts)

        # Safety check: ensure within media_dir
        try:
            file_path.resolve().relative_to(self.media_dir.resolve())
        except ValueError:
            raise ValueError("Path traversal detected")

        # Ensure directory exists
        await aiofiles.os.makedirs(file_path.parent, exist_ok=True)

        # Write file
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        return file_path

    def get_full_path(self, relative_path: str) -> Path:
        """Get full path for a relative path under media directory.

        Args:
            relative_path: Relative path like "documents/{id}/{filename}"

        Returns:
            Full Path object.
        """
        # Sanitize and construct path
        parts = relative_path.replace("\\", "/").split("/")
        safe_parts = []
        for part in parts:
            safe_part = Path(part).name
            if safe_part and safe_part not in (".", ".."):
                safe_parts.append(safe_part)

        if not safe_parts:
            raise ValueError("Invalid file path")

        full_path = self.media_dir.joinpath(*safe_parts)

        # Safety check
        try:
            full_path.resolve().relative_to(self.media_dir.resolve())
        except ValueError:
            raise ValueError("Path traversal detected")

        return full_path

    async def copy_file(self, source_path: Path | str, dest_relative_path: str) -> Path:
        """Copy a file to a new location.

        Args:
            source_path: Full path to source file
            dest_relative_path: Relative destination path like "recordings/{id}/{filename}"

        Returns:
            Full path where the file was copied.
        """
        source = Path(source_path)
        if not source.exists():
            raise FileNotFoundError(f"Source file not found: {source}")

        # Get destination full path using existing method
        dest_path = self.get_full_path(dest_relative_path)

        # Ensure directory exists
        await aiofiles.os.makedirs(dest_path.parent, exist_ok=True)

        # Copy file content
        async with aiofiles.open(source, "rb") as src:
            content = await src.read()
        async with aiofiles.open(dest_path, "wb") as dst:
            await dst.write(content)

        return dest_path

    async def ensure_project_folder(self, project_name: str) -> Path:
        """Ensure a project folder exists.

        Args:
            project_name: The project name.

        Returns:
            Path to the project folder.
        """
        safe_name = self._pm.sanitize_name(project_name)
        folder_path = self.media_dir / safe_name
        await self._pm.ensure_folder(folder_path)
        return folder_path

    async def rename_project_folder(self, old_name: str, new_name: str) -> Path:
        """Rename a project folder.

        Args:
            old_name: Current project name.
            new_name: New project name.

        Returns:
            New folder path.
        """
        old_safe = self._pm.sanitize_name(old_name)
        old_path = self.media_dir / old_safe

        if not old_path.exists():
            # Folder doesn't exist yet, just ensure new one exists
            return await self.ensure_project_folder(new_name)

        return await self._pm.rename_folder(old_path, new_name)

    async def delete_project_folder_if_empty(self, project_name: str) -> bool:
        """Delete a project folder if it's empty.

        Args:
            project_name: The project name.

        Returns:
            True if folder was deleted, False otherwise.
        """
        safe_name = self._pm.sanitize_name(project_name)
        folder_path = self.media_dir / safe_name
        return await self._pm.delete_folder_if_empty(folder_path)


# Default storage service instance
storage_service = StorageService()
