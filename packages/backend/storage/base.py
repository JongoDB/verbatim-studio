# packages/backend/storage/base.py
"""Base storage adapter interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator


@dataclass
class FileInfo:
    """Information about a file or directory."""

    name: str
    path: str
    size: int
    is_directory: bool
    modified_at: datetime
    mime_type: str | None = None


class StorageAdapter(ABC):
    """Abstract base class for storage adapters.

    All storage backends (local, network, cloud) implement this interface.
    """

    @abstractmethod
    async def test_connection(self) -> bool:
        """Verify connectivity and credentials."""
        ...

    @abstractmethod
    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files and directories at path."""
        ...

    @abstractmethod
    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        ...

    @abstractmethod
    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to file, creating directories as needed."""
        ...

    @abstractmethod
    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        ...

    @abstractmethod
    async def exists(self, path: str) -> bool:
        """Check if file or directory exists."""
        ...

    @abstractmethod
    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a single file."""
        ...

    @abstractmethod
    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist."""
        ...

    async def stream_file(self, path: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        """Stream file contents in chunks. Default reads entire file."""
        data = await self.read_file(path)
        for i in range(0, len(data), chunk_size):
            yield data[i:i + chunk_size]
