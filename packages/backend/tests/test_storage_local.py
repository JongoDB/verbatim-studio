# packages/backend/tests/test_storage_local.py
"""Tests for local storage adapter."""

import pytest
from pathlib import Path
import tempfile
import shutil

from storage.adapters.local import LocalAdapter
from storage.exceptions import StorageNotFoundError


@pytest.fixture
def temp_storage():
    """Create a temporary directory for testing."""
    path = Path(tempfile.mkdtemp())
    yield path
    shutil.rmtree(path)


@pytest.fixture
def adapter(temp_storage):
    """Create a LocalAdapter for the temp directory."""
    return LocalAdapter({"path": str(temp_storage)})


@pytest.mark.asyncio
async def test_test_connection(adapter, temp_storage):
    """Test connection should succeed for valid path."""
    assert await adapter.test_connection() is True


@pytest.mark.asyncio
async def test_test_connection_invalid_path():
    """Test connection should fail for non-existent path."""
    adapter = LocalAdapter({"path": "/nonexistent/path/12345"})
    with pytest.raises(Exception):
        await adapter.test_connection()


@pytest.mark.asyncio
async def test_write_and_read_file(adapter, temp_storage):
    """Write then read file."""
    await adapter.write_file("test.txt", b"hello world")
    content = await adapter.read_file("test.txt")
    assert content == b"hello world"
    assert (temp_storage / "test.txt").exists()


@pytest.mark.asyncio
async def test_write_creates_directories(adapter, temp_storage):
    """Write should create parent directories."""
    await adapter.write_file("a/b/c/test.txt", b"nested")
    assert (temp_storage / "a/b/c/test.txt").exists()
    content = await adapter.read_file("a/b/c/test.txt")
    assert content == b"nested"


@pytest.mark.asyncio
async def test_exists(adapter, temp_storage):
    """Check file and directory existence."""
    assert await adapter.exists("missing.txt") is False
    await adapter.write_file("exists.txt", b"data")
    assert await adapter.exists("exists.txt") is True
    await adapter.ensure_directory("subdir")
    assert await adapter.exists("subdir") is True


@pytest.mark.asyncio
async def test_delete_file(adapter, temp_storage):
    """Delete a file."""
    await adapter.write_file("to_delete.txt", b"bye")
    assert await adapter.exists("to_delete.txt") is True
    await adapter.delete_file("to_delete.txt")
    assert await adapter.exists("to_delete.txt") is False


@pytest.mark.asyncio
async def test_delete_nonexistent_raises(adapter):
    """Delete non-existent file should raise."""
    with pytest.raises(StorageNotFoundError):
        await adapter.delete_file("nonexistent.txt")


@pytest.mark.asyncio
async def test_list_files(adapter, temp_storage):
    """List files in directory."""
    await adapter.write_file("file1.txt", b"a")
    await adapter.write_file("file2.txt", b"b")
    await adapter.ensure_directory("subdir")

    files = await adapter.list_files("")
    names = {f.name for f in files}

    assert "file1.txt" in names
    assert "file2.txt" in names
    assert "subdir" in names


@pytest.mark.asyncio
async def test_get_file_info(adapter, temp_storage):
    """Get info for specific file."""
    await adapter.write_file("info_test.txt", b"test content")
    info = await adapter.get_file_info("info_test.txt")
    assert info.name == "info_test.txt"
    assert info.size == 12
    assert info.is_directory is False
