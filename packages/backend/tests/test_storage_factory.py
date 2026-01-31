# packages/backend/tests/test_storage_factory.py
"""Tests for storage adapter factory."""

import pytest
from unittest.mock import MagicMock

from storage.factory import get_adapter
from storage.adapters.local import LocalAdapter


def test_get_local_adapter():
    """Factory returns LocalAdapter for local type."""
    location = MagicMock()
    location.type = "local"
    location.subtype = None
    location.config = {"path": "/tmp/test"}

    adapter = get_adapter(location)

    assert isinstance(adapter, LocalAdapter)


def test_get_adapter_unknown_type():
    """Factory raises for unknown type."""
    location = MagicMock()
    location.type = "unknown"
    location.subtype = None
    location.config = {}

    with pytest.raises(ValueError, match="Unknown storage type"):
        get_adapter(location)
