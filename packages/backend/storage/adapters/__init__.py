# packages/backend/storage/adapters/__init__.py
"""Storage adapter implementations."""

from storage.adapters.local import LocalAdapter
from storage.adapters.gdrive import GDriveAdapter
from storage.adapters.onedrive import OneDriveAdapter
from storage.adapters.dropbox import DropboxAdapter

__all__ = ["LocalAdapter", "GDriveAdapter", "OneDriveAdapter", "DropboxAdapter"]
