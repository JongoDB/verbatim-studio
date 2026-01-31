# packages/backend/storage/__init__.py
"""Storage adapter package."""

from storage.base import StorageAdapter, FileInfo
from storage.exceptions import (
    StorageError,
    StorageUnavailableError,
    StorageAuthError,
    StorageNotFoundError,
    StoragePermissionError,
)

__all__ = [
    "StorageAdapter",
    "FileInfo",
    "StorageError",
    "StorageUnavailableError",
    "StorageAuthError",
    "StorageNotFoundError",
    "StoragePermissionError",
]
