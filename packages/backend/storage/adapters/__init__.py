# packages/backend/storage/adapters/__init__.py
"""Storage adapter implementations."""

from storage.adapters.local import LocalAdapter
from storage.adapters.gdrive import GDriveAdapter

__all__ = ["LocalAdapter", "GDriveAdapter"]
