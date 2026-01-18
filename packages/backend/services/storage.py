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
        """
        # Create a subdirectory based on recording ID to avoid filename collisions
        recording_dir = self.media_dir / "recordings" / recording_id
        return recording_dir / filename

    async def save_upload(
        self, content: bytes, recording_id: str, filename: str
    ) -> Path:
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


# Default storage service instance
storage_service = StorageService()
