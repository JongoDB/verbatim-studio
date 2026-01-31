# packages/backend/storage/adapters/__init__.py
"""Storage adapter implementations."""

from storage.adapters.local import LocalAdapter

__all__ = ["LocalAdapter"]
