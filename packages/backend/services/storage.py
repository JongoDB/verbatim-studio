"""Storage service for file management."""

from pathlib import Path

import aiofiles
import aiofiles.os

from core.config import settings


class StorageService:
    """Service for managing file storage operations."""

    def __init__(self, media_dir: Path | None = None):
        """Initialize storage service.

        Args:
            media_dir: Override for media directory. Uses settings.MEDIA_DIR by default.
        """
        self.media_dir = media_dir or settings.MEDIA_DIR

    def get_recording_path(self, recording_id: str, filename: str) -> Path:
        """Get the full path for a recording file.

        Args:
            recording_id: The recording's unique ID.
            filename: Original filename with extension.

        Returns:
            Full path where the recording file should be stored.

        Raises:
            ValueError: If filename contains path traversal attempts.
        """
        # Defense in depth: sanitize filename to prevent path traversal
        # First normalize backslashes to forward slashes (handles Windows-style paths on any OS)
        # Then use Path().name to get only the basename, stripping any directory components
        normalized_filename = filename.replace("\\", "/")
        safe_filename = Path(normalized_filename).name
        if not safe_filename or safe_filename in (".", ".."):
            safe_filename = "unknown"

        # Also sanitize recording_id to prevent path traversal via that parameter
        normalized_recording_id = recording_id.replace("\\", "/")
        safe_recording_id = Path(normalized_recording_id).name
        if not safe_recording_id or safe_recording_id in (".", ".."):
            raise ValueError("Invalid recording ID")

        # Create a subdirectory based on recording ID to avoid filename collisions
        recording_dir = self.media_dir / "recordings" / safe_recording_id
        result_path = recording_dir / safe_filename

        # Final safety check: ensure resulting path is within media_dir
        try:
            result_path.resolve().relative_to(self.media_dir.resolve())
        except ValueError:
            raise ValueError("Path traversal detected in filename or recording_id")

        return result_path

    async def save_upload(self, content: bytes, recording_id: str, filename: str) -> Path:
        """Save an uploaded file to storage.

        Args:
            content: File content as bytes.
            recording_id: The recording's unique ID.
            filename: Original filename.

        Returns:
            Path where the file was saved.
        """
        file_path = self.get_recording_path(recording_id, filename)

        # Ensure the directory exists
        await aiofiles.os.makedirs(file_path.parent, exist_ok=True)

        # Write the file
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        return file_path

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
            # Try to remove parent directory if empty
            try:
                await aiofiles.os.rmdir(path.parent)
            except OSError:
                # Directory not empty or other error, ignore
                pass
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
        # Split path and sanitize each component
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


# Default storage service instance
storage_service = StorageService()
