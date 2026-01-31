# Storage Location Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for multiple storage backends: Local, Network (SMB/NFS), and Cloud (S3, Google Drive, OneDrive, Dropbox, Azure Blob, GCS).

**Architecture:** Adapter pattern with abstract `StorageAdapter` interface. Each storage type has its own adapter implementation. Credentials are encrypted using Fernet with master key stored in OS keychain. OAuth providers use local redirect server for authentication.

**Tech Stack:** Python (smbprotocol, aioboto3, keyring, cryptography, aiohttp), React (TypeScript, shadcn/ui)

---

## Phase 1: Foundation

### Task 1: Database Migration - Add subtype Column

**Files:**
- Create: `packages/backend/migrations/add_storage_subtype.py`
- Modify: `packages/backend/persistence/models.py:282-294`

**Step 1: Create migration script**

```python
# packages/backend/migrations/add_storage_subtype.py
"""Add subtype column to storage_locations table."""

import sqlite3
from pathlib import Path


def migrate(db_path: Path) -> None:
    """Add subtype column to storage_locations."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check if column already exists
    cursor.execute("PRAGMA table_info(storage_locations)")
    columns = [col[1] for col in cursor.fetchall()]

    if "subtype" not in columns:
        cursor.execute(
            "ALTER TABLE storage_locations ADD COLUMN subtype VARCHAR(50)"
        )
        conn.commit()
        print("Added subtype column to storage_locations")
    else:
        print("subtype column already exists")

    # Add status column for health tracking
    if "status" not in columns:
        cursor.execute(
            "ALTER TABLE storage_locations ADD COLUMN status VARCHAR(20) DEFAULT 'healthy'"
        )
        conn.commit()
        print("Added status column to storage_locations")

    conn.close()


if __name__ == "__main__":
    db_path = Path(__file__).parent.parent / "verbatim.db"
    migrate(db_path)
```

**Step 2: Update SQLAlchemy model**

In `packages/backend/persistence/models.py`, update StorageLocation class:

```python
class StorageLocation(Base):
    """Configurable storage location for files (local, network, cloud)."""

    __tablename__ = "storage_locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # "local", "network", "cloud"
    subtype: Mapped[str | None] = mapped_column(String(50))  # "smb", "nfs", "s3", "gdrive", etc.
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="healthy")  # healthy, degraded, unreachable, auth_expired
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
```

**Step 3: Run migration**

```bash
cd packages/backend
python migrations/add_storage_subtype.py
```

**Step 4: Commit**

```bash
git add packages/backend/migrations/add_storage_subtype.py packages/backend/persistence/models.py
git commit -m "feat: add subtype and status columns to storage_locations

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Create Encryption Service

**Files:**
- Create: `packages/backend/services/encryption.py`
- Create: `packages/backend/tests/test_encryption.py`

**Step 1: Write the failing test**

```python
# packages/backend/tests/test_encryption.py
"""Tests for credential encryption service."""

import pytest
from services.encryption import encrypt_config, decrypt_config, SENSITIVE_FIELDS


def test_encrypt_decrypt_roundtrip():
    """Encrypted config should decrypt back to original."""
    original = {
        "bucket": "my-bucket",
        "region": "us-east-1",
        "access_key": "AKIAIOSFODNN7EXAMPLE",
        "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    }

    encrypted = encrypt_config(original)

    # Non-sensitive fields unchanged
    assert encrypted["bucket"] == "my-bucket"
    assert encrypted["region"] == "us-east-1"
    assert encrypted["access_key"] == "AKIAIOSFODNN7EXAMPLE"

    # Sensitive field is encrypted
    assert "_encrypted" in encrypted["secret_key"]
    assert encrypted["secret_key"]["_encrypted"] != original["secret_key"]

    # Decrypt back
    decrypted = decrypt_config(encrypted)
    assert decrypted == original


def test_encrypt_empty_config():
    """Empty config should remain empty."""
    assert encrypt_config({}) == {}
    assert decrypt_config({}) == {}


def test_encrypt_none_values():
    """None values should be preserved."""
    config = {"password": None, "username": "admin"}
    encrypted = encrypt_config(config)
    assert encrypted["password"] is None
    assert encrypted["username"] == "admin"


def test_sensitive_fields_list():
    """Verify expected sensitive fields."""
    expected = {
        "password", "secret_key", "account_key", "connection_string",
        "credentials_json", "oauth_tokens", "access_token", "refresh_token"
    }
    assert SENSITIVE_FIELDS == expected
```

**Step 2: Run test to verify it fails**

```bash
cd packages/backend
python -m pytest tests/test_encryption.py -v
```

Expected: FAIL with "ModuleNotFoundError: No module named 'services.encryption'"

**Step 3: Write the implementation**

```python
# packages/backend/services/encryption.py
"""Credential encryption service using Fernet with OS keychain."""

import base64
import json
import logging
import os
from pathlib import Path

import keyring
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

SERVICE_NAME = "verbatim-studio"
KEY_NAME = "master-key"
FALLBACK_PATH = Path.home() / ".verbatim-studio" / ".keyfile"

SENSITIVE_FIELDS = {
    "password",
    "secret_key",
    "account_key",
    "connection_string",
    "credentials_json",
    "oauth_tokens",
    "access_token",
    "refresh_token",
}


def get_master_key() -> bytes:
    """Get or create master encryption key.

    Tries OS keychain first, falls back to file-based storage.
    """
    # Try OS keychain first
    try:
        key = keyring.get_password(SERVICE_NAME, KEY_NAME)
        if key:
            return base64.b64decode(key)
    except Exception as e:
        logger.debug(f"Keyring unavailable: {e}")

    # Try fallback file
    if FALLBACK_PATH.exists():
        return FALLBACK_PATH.read_bytes()

    # Generate new key
    new_key = Fernet.generate_key()

    # Try to store in keychain
    try:
        keyring.set_password(SERVICE_NAME, KEY_NAME, base64.b64encode(new_key).decode())
        logger.info("Master key stored in OS keychain")
        return new_key
    except Exception as e:
        logger.warning(f"Could not store key in keychain: {e}")

    # Fall back to file
    FALLBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    FALLBACK_PATH.write_bytes(new_key)
    FALLBACK_PATH.chmod(0o600)
    logger.warning(f"Master key stored in fallback file: {FALLBACK_PATH}")
    return new_key


def get_fernet() -> Fernet:
    """Get Fernet instance with master key."""
    return Fernet(get_master_key())


def encrypt_config(config: dict) -> dict:
    """Encrypt sensitive fields in config.

    Non-sensitive fields are left as-is.
    Sensitive fields become {"_encrypted": "base64-ciphertext"}.
    """
    if not config:
        return config

    fernet = get_fernet()
    result = {}

    for key, value in config.items():
        if key in SENSITIVE_FIELDS and value is not None:
            encrypted = fernet.encrypt(json.dumps(value).encode())
            result[key] = {"_encrypted": base64.b64encode(encrypted).decode()}
        else:
            result[key] = value

    return result


def decrypt_config(config: dict) -> dict:
    """Decrypt sensitive fields in config.

    Fields with {"_encrypted": ...} are decrypted.
    Other fields are left as-is.
    """
    if not config:
        return config

    fernet = get_fernet()
    result = {}

    for key, value in config.items():
        if isinstance(value, dict) and "_encrypted" in value:
            try:
                decrypted = fernet.decrypt(base64.b64decode(value["_encrypted"]))
                result[key] = json.loads(decrypted.decode())
            except Exception as e:
                logger.error(f"Failed to decrypt {key}: {e}")
                result[key] = None
        else:
            result[key] = value

    return result
```

**Step 4: Run test to verify it passes**

```bash
cd packages/backend
python -m pytest tests/test_encryption.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/services/encryption.py packages/backend/tests/test_encryption.py
git commit -m "feat: add credential encryption service with keychain support

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Create Storage Adapter Base Class

**Files:**
- Create: `packages/backend/storage/__init__.py`
- Create: `packages/backend/storage/base.py`
- Create: `packages/backend/storage/exceptions.py`

**Step 1: Create the package and base classes**

```python
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
```

```python
# packages/backend/storage/exceptions.py
"""Storage adapter exceptions."""


class StorageError(Exception):
    """Base storage error."""
    pass


class StorageUnavailableError(StorageError):
    """Storage location is unreachable."""
    pass


class StorageAuthError(StorageError):
    """Authentication failed or expired."""
    pass


class StorageNotFoundError(StorageError):
    """File or directory not found."""
    pass


class StoragePermissionError(StorageError):
    """Permission denied."""
    pass
```

```python
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
        """Verify connectivity and credentials.

        Returns True if connection successful.
        Raises StorageError subclass on failure.
        """
        ...

    @abstractmethod
    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files and directories at path.

        Args:
            path: Relative path within storage location. Empty string for root.

        Returns:
            List of FileInfo objects.

        Raises:
            StorageNotFoundError: If path doesn't exist.
            StoragePermissionError: If access denied.
        """
        ...

    @abstractmethod
    async def read_file(self, path: str) -> bytes:
        """Read file contents.

        Args:
            path: Relative path to file.

        Returns:
            File contents as bytes.

        Raises:
            StorageNotFoundError: If file doesn't exist.
        """
        ...

    @abstractmethod
    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to file.

        Creates parent directories as needed.
        Overwrites existing file.

        Args:
            path: Relative path to file.
            data: File contents.
        """
        ...

    @abstractmethod
    async def delete_file(self, path: str) -> None:
        """Delete a file.

        Args:
            path: Relative path to file.

        Raises:
            StorageNotFoundError: If file doesn't exist.
        """
        ...

    @abstractmethod
    async def exists(self, path: str) -> bool:
        """Check if file or directory exists.

        Args:
            path: Relative path to check.

        Returns:
            True if exists, False otherwise.
        """
        ...

    @abstractmethod
    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a single file.

        Args:
            path: Relative path to file.

        Returns:
            FileInfo object.

        Raises:
            StorageNotFoundError: If file doesn't exist.
        """
        ...

    @abstractmethod
    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist.

        Args:
            path: Relative path to directory.
        """
        ...

    async def stream_file(self, path: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        """Stream file contents in chunks.

        Default implementation reads entire file. Subclasses can override
        for more efficient streaming.

        Args:
            path: Relative path to file.
            chunk_size: Size of each chunk in bytes.

        Yields:
            File content chunks.
        """
        data = await self.read_file(path)
        for i in range(0, len(data), chunk_size):
            yield data[i:i + chunk_size]
```

**Step 2: Commit**

```bash
git add packages/backend/storage/
git commit -m "feat: add storage adapter base class and exceptions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Implement LocalAdapter

**Files:**
- Create: `packages/backend/storage/adapters/__init__.py`
- Create: `packages/backend/storage/adapters/local.py`
- Create: `packages/backend/tests/test_storage_local.py`

**Step 1: Write the failing test**

```python
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

    # Verify file exists on disk
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

    # Check file info
    file1 = next(f for f in files if f.name == "file1.txt")
    assert file1.size == 1
    assert file1.is_directory is False

    subdir = next(f for f in files if f.name == "subdir")
    assert subdir.is_directory is True


@pytest.mark.asyncio
async def test_get_file_info(adapter, temp_storage):
    """Get info for specific file."""
    await adapter.write_file("info_test.txt", b"test content")

    info = await adapter.get_file_info("info_test.txt")

    assert info.name == "info_test.txt"
    assert info.size == 12
    assert info.is_directory is False
    assert info.mime_type == "text/plain"
```

**Step 2: Run test to verify it fails**

```bash
cd packages/backend
python -m pytest tests/test_storage_local.py -v
```

Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# packages/backend/storage/adapters/__init__.py
"""Storage adapter implementations."""

from storage.adapters.local import LocalAdapter

__all__ = ["LocalAdapter"]
```

```python
# packages/backend/storage/adapters/local.py
"""Local filesystem storage adapter."""

import mimetypes
from datetime import datetime
from pathlib import Path

import aiofiles
import aiofiles.os

from storage.base import StorageAdapter, FileInfo
from storage.exceptions import (
    StorageNotFoundError,
    StoragePermissionError,
    StorageUnavailableError,
)


class LocalAdapter(StorageAdapter):
    """Storage adapter for local filesystem."""

    def __init__(self, config: dict):
        """Initialize with config containing 'path'."""
        self.base_path = Path(config["path"])

    def _resolve_path(self, path: str) -> Path:
        """Resolve relative path to absolute, preventing traversal."""
        if not path:
            return self.base_path

        resolved = (self.base_path / path).resolve()

        # Prevent directory traversal
        if not str(resolved).startswith(str(self.base_path.resolve())):
            raise StoragePermissionError(f"Path traversal not allowed: {path}")

        return resolved

    async def test_connection(self) -> bool:
        """Verify base path exists and is writable."""
        if not self.base_path.exists():
            raise StorageUnavailableError(f"Path does not exist: {self.base_path}")

        if not self.base_path.is_dir():
            raise StorageUnavailableError(f"Path is not a directory: {self.base_path}")

        # Test write access
        test_file = self.base_path / ".write_test"
        try:
            test_file.touch()
            test_file.unlink()
        except PermissionError:
            raise StoragePermissionError(f"Cannot write to: {self.base_path}")

        return True

    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files in directory."""
        dir_path = self._resolve_path(path)

        if not dir_path.exists():
            raise StorageNotFoundError(f"Directory not found: {path}")

        if not dir_path.is_dir():
            raise StorageNotFoundError(f"Not a directory: {path}")

        files = []
        for item in dir_path.iterdir():
            stat = item.stat()
            mime_type = None
            if item.is_file():
                mime_type, _ = mimetypes.guess_type(str(item))

            files.append(FileInfo(
                name=item.name,
                path=str(item.relative_to(self.base_path)),
                size=stat.st_size if item.is_file() else 0,
                is_directory=item.is_dir(),
                modified_at=datetime.fromtimestamp(stat.st_mtime),
                mime_type=mime_type,
            ))

        return files

    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        file_path = self._resolve_path(path)

        if not file_path.exists():
            raise StorageNotFoundError(f"File not found: {path}")

        if not file_path.is_file():
            raise StorageNotFoundError(f"Not a file: {path}")

        async with aiofiles.open(file_path, "rb") as f:
            return await f.read()

    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to file, creating directories as needed."""
        file_path = self._resolve_path(path)

        # Create parent directories
        await aiofiles.os.makedirs(file_path.parent, exist_ok=True)

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(data)

    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        file_path = self._resolve_path(path)

        if not file_path.exists():
            raise StorageNotFoundError(f"File not found: {path}")

        await aiofiles.os.remove(file_path)

    async def exists(self, path: str) -> bool:
        """Check if path exists."""
        return self._resolve_path(path).exists()

    async def get_file_info(self, path: str) -> FileInfo:
        """Get file metadata."""
        file_path = self._resolve_path(path)

        if not file_path.exists():
            raise StorageNotFoundError(f"File not found: {path}")

        stat = file_path.stat()
        mime_type = None
        if file_path.is_file():
            mime_type, _ = mimetypes.guess_type(str(file_path))

        return FileInfo(
            name=file_path.name,
            path=path,
            size=stat.st_size if file_path.is_file() else 0,
            is_directory=file_path.is_dir(),
            modified_at=datetime.fromtimestamp(stat.st_mtime),
            mime_type=mime_type,
        )

    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents."""
        dir_path = self._resolve_path(path)
        await aiofiles.os.makedirs(dir_path, exist_ok=True)
```

**Step 4: Run test to verify it passes**

```bash
cd packages/backend
python -m pytest tests/test_storage_local.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/storage/adapters/
git add packages/backend/tests/test_storage_local.py
git commit -m "feat: implement LocalAdapter for filesystem storage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Create Adapter Factory

**Files:**
- Create: `packages/backend/storage/factory.py`
- Create: `packages/backend/tests/test_storage_factory.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
cd packages/backend
python -m pytest tests/test_storage_factory.py -v
```

Expected: FAIL

**Step 3: Write the implementation**

```python
# packages/backend/storage/factory.py
"""Storage adapter factory."""

from persistence.models import StorageLocation
from services.encryption import decrypt_config
from storage.base import StorageAdapter
from storage.adapters.local import LocalAdapter


# Registry of adapter classes by (type, subtype)
ADAPTER_REGISTRY: dict[tuple[str, str | None], type[StorageAdapter]] = {
    ("local", None): LocalAdapter,
}


def get_adapter(location: StorageLocation) -> StorageAdapter:
    """Get appropriate storage adapter for a location.

    Args:
        location: StorageLocation model instance.

    Returns:
        Configured StorageAdapter instance.

    Raises:
        ValueError: If storage type is not supported.
    """
    key = (location.type, location.subtype)

    # Try exact match first
    adapter_class = ADAPTER_REGISTRY.get(key)

    # Fall back to type-only match
    if adapter_class is None:
        adapter_class = ADAPTER_REGISTRY.get((location.type, None))

    if adapter_class is None:
        raise ValueError(
            f"Unknown storage type: {location.type}/{location.subtype}"
        )

    # Decrypt credentials before passing to adapter
    config = decrypt_config(location.config or {})

    return adapter_class(config)


def register_adapter(
    storage_type: str,
    subtype: str | None,
    adapter_class: type[StorageAdapter]
) -> None:
    """Register an adapter class for a storage type.

    Args:
        storage_type: Primary type (local, network, cloud).
        subtype: Subtype (smb, s3, gdrive, etc.) or None.
        adapter_class: StorageAdapter subclass.
    """
    ADAPTER_REGISTRY[(storage_type, subtype)] = adapter_class
```

**Step 4: Run test to verify it passes**

```bash
cd packages/backend
python -m pytest tests/test_storage_factory.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/storage/factory.py packages/backend/tests/test_storage_factory.py
git commit -m "feat: add storage adapter factory with registry

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Update API Routes for New Schema

**Files:**
- Modify: `packages/backend/api/routes/storage_locations.py`
- Create: `packages/backend/tests/test_storage_locations_api.py`

**Step 1: Update the Pydantic models and add test endpoint**

Update `packages/backend/api/routes/storage_locations.py`:

```python
"""Storage location management endpoints."""

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from persistence.database import async_session
from persistence.models import StorageLocation
from services.encryption import encrypt_config, decrypt_config
from storage.factory import get_adapter
from storage.exceptions import StorageError, StorageAuthError, StorageUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-locations", tags=["storage-locations"])

# Track migration progress in memory
_migration_progress: dict[str, dict] = {}


class StorageLocationConfig(BaseModel):
    """Storage location configuration (varies by type)."""

    # Local
    path: str | None = None

    # Network - SMB
    server: str | None = None
    share: str | None = None
    username: str | None = None
    password: str | None = None
    domain: str | None = None

    # Network - NFS
    export_path: str | None = None
    mount_options: str | None = None

    # Cloud - S3
    bucket: str | None = None
    region: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    endpoint: str | None = None

    # Cloud - Azure
    container: str | None = None
    account_name: str | None = None
    account_key: str | None = None
    connection_string: str | None = None

    # Cloud - GCS
    project_id: str | None = None
    credentials_json: str | None = None

    # Cloud - OAuth (GDrive, OneDrive, Dropbox)
    folder_id: str | None = None
    folder_path: str | None = None
    oauth_tokens: dict | None = None

    class Config:
        extra = "allow"  # Allow additional fields


class StorageLocationResponse(BaseModel):
    """Storage location response model."""

    id: str
    name: str
    type: str
    subtype: str | None
    config: dict[str, Any]  # Only non-sensitive fields
    is_default: bool
    is_active: bool
    status: str
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, loc: StorageLocation) -> "StorageLocationResponse":
        # Return config without sensitive fields for display
        safe_config = {}
        sensitive = {"password", "secret_key", "account_key", "connection_string",
                    "credentials_json", "oauth_tokens", "access_token", "refresh_token"}

        for key, value in (loc.config or {}).items():
            if key in sensitive:
                safe_config[key] = "***" if value else None
            elif isinstance(value, dict) and "_encrypted" in value:
                safe_config[key] = "***"
            else:
                safe_config[key] = value

        return cls(
            id=loc.id,
            name=loc.name,
            type=loc.type,
            subtype=loc.subtype,
            config=safe_config,
            is_default=loc.is_default,
            is_active=loc.is_active,
            status=loc.status or "healthy",
            created_at=loc.created_at.isoformat() if loc.created_at else "",
            updated_at=loc.updated_at.isoformat() if loc.updated_at else "",
        )


class StorageLocationListResponse(BaseModel):
    """List of storage locations."""

    items: list[StorageLocationResponse]
    total: int


class StorageLocationCreate(BaseModel):
    """Create a storage location."""

    name: str
    type: str = "local"
    subtype: str | None = None
    config: StorageLocationConfig
    is_default: bool = False


class StorageLocationUpdate(BaseModel):
    """Update a storage location."""

    name: str | None = None
    config: StorageLocationConfig | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class TestConnectionRequest(BaseModel):
    """Request to test a storage connection."""

    type: str
    subtype: str | None = None
    config: StorageLocationConfig


class TestConnectionResponse(BaseModel):
    """Response from connection test."""

    success: bool
    error: str | None = None
    latency_ms: float | None = None


@router.post("/test", response_model=TestConnectionResponse)
async def test_connection(body: TestConnectionRequest) -> TestConnectionResponse:
    """Test a storage connection before saving.

    This validates credentials and connectivity without creating a location.
    """
    import time

    # Create a mock location for the factory
    class MockLocation:
        def __init__(self, type_: str, subtype: str | None, config: dict):
            self.type = type_
            self.subtype = subtype
            self.config = config

    config_dict = body.config.model_dump(exclude_none=True)
    mock_loc = MockLocation(body.type, body.subtype, config_dict)

    try:
        start = time.monotonic()
        adapter = get_adapter(mock_loc)
        await adapter.test_connection()
        elapsed = (time.monotonic() - start) * 1000

        return TestConnectionResponse(success=True, latency_ms=elapsed)

    except StorageAuthError as e:
        return TestConnectionResponse(success=False, error=f"Authentication failed: {e}")
    except StorageUnavailableError as e:
        return TestConnectionResponse(success=False, error=f"Cannot connect: {e}")
    except StorageError as e:
        return TestConnectionResponse(success=False, error=str(e))
    except ValueError as e:
        return TestConnectionResponse(success=False, error=str(e))
    except Exception as e:
        logger.exception("Connection test failed")
        return TestConnectionResponse(success=False, error=f"Unexpected error: {e}")


# ... rest of existing endpoints with updated encryption handling ...
```

**Step 2: Write API test**

```python
# packages/backend/tests/test_storage_locations_api.py
"""Tests for storage locations API endpoints."""

import pytest
from fastapi.testclient import TestClient
import tempfile
from pathlib import Path

from api.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def temp_dir():
    """Create a temporary directory."""
    path = Path(tempfile.mkdtemp())
    yield path
    import shutil
    shutil.rmtree(path, ignore_errors=True)


def test_test_connection_local_valid(client, temp_dir):
    """Test connection should succeed for valid local path."""
    response = client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": str(temp_dir)}
    })

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["latency_ms"] is not None


def test_test_connection_local_invalid(client):
    """Test connection should fail for invalid path."""
    response = client.post("/api/storage-locations/test", json={
        "type": "local",
        "config": {"path": "/nonexistent/path/xyz123"}
    })

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Cannot connect" in data["error"] or "not exist" in data["error"].lower()


def test_test_connection_unknown_type(client):
    """Test connection should fail for unknown type."""
    response = client.post("/api/storage-locations/test", json={
        "type": "unknown_type",
        "config": {}
    })

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Unknown storage type" in data["error"]
```

**Step 3: Run tests**

```bash
cd packages/backend
python -m pytest tests/test_storage_locations_api.py -v
```

**Step 4: Commit**

```bash
git add packages/backend/api/routes/storage_locations.py
git add packages/backend/tests/test_storage_locations_api.py
git commit -m "feat: add test connection endpoint and update API schema

- Add POST /storage-locations/test endpoint
- Update schema to include subtype and all config fields
- Mask sensitive fields in responses
- Encrypt credentials before storage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Update Frontend Types and API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Update TypeScript interfaces**

In `packages/frontend/src/lib/api.ts`, update the storage location types:

```typescript
// Storage Locations
export type StorageType = 'local' | 'network' | 'cloud';
export type StorageSubtype =
  | null
  | 'smb' | 'nfs'  // network
  | 's3' | 'azure' | 'gcs' | 'gdrive' | 'onedrive' | 'dropbox';  // cloud

export interface StorageLocationConfig {
  // Local
  path?: string;

  // Network - SMB
  server?: string;
  share?: string;
  username?: string;
  password?: string;
  domain?: string;

  // Network - NFS
  export_path?: string;
  mount_options?: string;

  // Cloud - S3
  bucket?: string;
  region?: string;
  access_key?: string;
  secret_key?: string;
  endpoint?: string;

  // Cloud - Azure
  container?: string;
  account_name?: string;
  account_key?: string;
  connection_string?: string;

  // Cloud - GCS
  project_id?: string;
  credentials_json?: string;

  // Cloud - OAuth
  folder_id?: string;
  folder_path?: string;
  oauth_tokens?: Record<string, unknown>;

  [key: string]: unknown;
}

export interface StorageLocation {
  id: string;
  name: string;
  type: StorageType;
  subtype: StorageSubtype;
  config: StorageLocationConfig;
  is_default: boolean;
  is_active: boolean;
  status: 'healthy' | 'degraded' | 'unreachable' | 'auth_expired';
  created_at: string;
  updated_at: string;
}

export interface StorageLocationListResponse {
  items: StorageLocation[];
  total: number;
}

export interface StorageLocationCreate {
  name: string;
  type?: StorageType;
  subtype?: StorageSubtype;
  config: StorageLocationConfig;
  is_default?: boolean;
}

export interface StorageLocationUpdate {
  name?: string;
  config?: StorageLocationConfig;
  is_default?: boolean;
  is_active?: boolean;
}

export interface TestConnectionRequest {
  type: StorageType;
  subtype?: StorageSubtype;
  config: StorageLocationConfig;
}

export interface TestConnectionResponse {
  success: boolean;
  error?: string;
  latency_ms?: number;
}
```

Also update the API client methods:

```typescript
  storageLocations = {
    list: () => this.request<StorageLocationListResponse>('/api/storage-locations'),

    get: (id: string) => this.request<StorageLocation>(`/api/storage-locations/${id}`),

    create: (data: StorageLocationCreate) =>
      this.request<StorageLocation>('/api/storage-locations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: StorageLocationUpdate) =>
      this.request<StorageLocation>(`/api/storage-locations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<void>(`/api/storage-locations/${id}`, {
        method: 'DELETE',
      }),

    test: (data: TestConnectionRequest) =>
      this.request<TestConnectionResponse>('/api/storage-locations/test', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    migrate: (data: MigrationRequest) =>
      this.request<MigrationStatus>('/api/storage-locations/migrate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    getMigrationStatus: () =>
      this.request<MigrationStatus>('/api/storage-locations/migrate/status'),
  };
```

**Step 2: Run TypeScript check**

```bash
cd packages/frontend
pnpm tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat: update frontend types for storage location types

- Add StorageType and StorageSubtype types
- Expand StorageLocationConfig with all provider fields
- Add status field to StorageLocation
- Add test connection API method

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Create Storage Type Selector Component

**Files:**
- Create: `packages/frontend/src/components/storage/StorageTypeSelector.tsx`

**Step 1: Create the component**

```tsx
// packages/frontend/src/components/storage/StorageTypeSelector.tsx
import { HardDrive, Server, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StorageType } from '@/lib/api';

interface StorageTypeSelectorProps {
  value: StorageType;
  onChange: (type: StorageType) => void;
}

const types: { type: StorageType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    type: 'local',
    label: 'Local Storage',
    description: 'Folder on this computer',
    icon: <HardDrive className="w-8 h-8" />,
  },
  {
    type: 'network',
    label: 'Network Storage',
    description: 'SMB or NFS share',
    icon: <Server className="w-8 h-8" />,
  },
  {
    type: 'cloud',
    label: 'Cloud Storage',
    description: 'S3, Google Drive, etc.',
    icon: <Cloud className="w-8 h-8" />,
  },
];

export function StorageTypeSelector({ value, onChange }: StorageTypeSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {types.map(({ type, label, description, icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={cn(
            'flex flex-col items-center p-4 rounded-lg border-2 transition-all',
            'hover:border-primary hover:bg-primary/5',
            value === type
              ? 'border-primary bg-primary/10'
              : 'border-gray-200 dark:border-gray-700'
          )}
        >
          <div className={cn(
            'mb-2',
            value === type ? 'text-primary' : 'text-gray-500 dark:text-gray-400'
          )}>
            {icon}
          </div>
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
            {description}
          </span>
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/storage/
git commit -m "feat: add StorageTypeSelector component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Create Storage Subtype Selector Component

**Files:**
- Create: `packages/frontend/src/components/storage/StorageSubtypeSelector.tsx`

**Step 1: Create the component**

```tsx
// packages/frontend/src/components/storage/StorageSubtypeSelector.tsx
import { cn } from '@/lib/utils';
import type { StorageType, StorageSubtype } from '@/lib/api';

interface StorageSubtypeSelectorProps {
  storageType: StorageType;
  value: StorageSubtype;
  onChange: (subtype: StorageSubtype) => void;
}

const subtypes: Record<StorageType, { subtype: StorageSubtype; label: string; description: string }[]> = {
  local: [],
  network: [
    { subtype: 'smb', label: 'SMB / Windows Share', description: 'Samba, Windows file sharing' },
    { subtype: 'nfs', label: 'NFS', description: 'Network File System (Unix/Linux)' },
  ],
  cloud: [
    { subtype: 's3', label: 'S3-Compatible', description: 'AWS S3, Backblaze B2, MinIO, Wasabi' },
    { subtype: 'gdrive', label: 'Google Drive', description: 'Personal or Workspace account' },
    { subtype: 'onedrive', label: 'OneDrive', description: 'Microsoft OneDrive' },
    { subtype: 'dropbox', label: 'Dropbox', description: 'Dropbox cloud storage' },
    { subtype: 'azure', label: 'Azure Blob', description: 'Microsoft Azure Blob Storage' },
    { subtype: 'gcs', label: 'Google Cloud Storage', description: 'GCS bucket' },
  ],
};

export function StorageSubtypeSelector({ storageType, value, onChange }: StorageSubtypeSelectorProps) {
  const options = subtypes[storageType];

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Select Provider
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ subtype, label, description }) => (
          <button
            key={subtype}
            type="button"
            onClick={() => onChange(subtype)}
            className={cn(
              'flex flex-col items-start p-3 rounded-lg border transition-all text-left',
              'hover:border-primary hover:bg-primary/5',
              value === subtype
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700'
            )}
          >
            <span className="font-medium text-sm">{label}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/storage/StorageSubtypeSelector.tsx
git commit -m "feat: add StorageSubtypeSelector component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Create Storage Config Form Component

**Files:**
- Create: `packages/frontend/src/components/storage/StorageConfigForm.tsx`

**Step 1: Create the component**

```tsx
// packages/frontend/src/components/storage/StorageConfigForm.tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StorageType, StorageSubtype, StorageLocationConfig } from '@/lib/api';

interface StorageConfigFormProps {
  storageType: StorageType;
  subtype: StorageSubtype;
  config: StorageLocationConfig;
  onChange: (config: StorageLocationConfig) => void;
}

export function StorageConfigForm({ storageType, subtype, config, onChange }: StorageConfigFormProps) {
  const updateField = (field: string, value: string) => {
    onChange({ ...config, [field]: value || undefined });
  };

  // Local storage
  if (storageType === 'local') {
    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="path">Path</Label>
          <Input
            id="path"
            value={config.path || ''}
            onChange={(e) => updateField('path', e.target.value)}
            placeholder="/path/to/storage"
            className="font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Full path to a folder. It will be created if it doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  // SMB
  if (storageType === 'network' && subtype === 'smb') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="server">Server</Label>
            <Input
              id="server"
              value={config.server || ''}
              onChange={(e) => updateField('server', e.target.value)}
              placeholder="192.168.1.100 or nas.local"
            />
          </div>
          <div>
            <Label htmlFor="share">Share Name</Label>
            <Input
              id="share"
              value={config.share || ''}
              onChange={(e) => updateField('share', e.target.value)}
              placeholder="media"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={config.username || ''}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder="user"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={config.password || ''}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="domain">Domain (optional)</Label>
          <Input
            id="domain"
            value={config.domain || ''}
            onChange={(e) => updateField('domain', e.target.value)}
            placeholder="WORKGROUP"
          />
        </div>
      </div>
    );
  }

  // NFS
  if (storageType === 'network' && subtype === 'nfs') {
    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="server">Server</Label>
          <Input
            id="server"
            value={config.server || ''}
            onChange={(e) => updateField('server', e.target.value)}
            placeholder="192.168.1.100 or nfs.local"
          />
        </div>
        <div>
          <Label htmlFor="export_path">Export Path</Label>
          <Input
            id="export_path"
            value={config.export_path || ''}
            onChange={(e) => updateField('export_path', e.target.value)}
            placeholder="/exports/media"
            className="font-mono"
          />
        </div>
        <div>
          <Label htmlFor="mount_options">Mount Options (optional)</Label>
          <Input
            id="mount_options"
            value={config.mount_options || ''}
            onChange={(e) => updateField('mount_options', e.target.value)}
            placeholder="rw,sync"
          />
        </div>
      </div>
    );
  }

  // S3
  if (storageType === 'cloud' && subtype === 's3') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="bucket">Bucket</Label>
            <Input
              id="bucket"
              value={config.bucket || ''}
              onChange={(e) => updateField('bucket', e.target.value)}
              placeholder="my-bucket"
            />
          </div>
          <div>
            <Label htmlFor="region">Region</Label>
            <Input
              id="region"
              value={config.region || ''}
              onChange={(e) => updateField('region', e.target.value)}
              placeholder="us-east-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="access_key">Access Key</Label>
            <Input
              id="access_key"
              value={config.access_key || ''}
              onChange={(e) => updateField('access_key', e.target.value)}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className="font-mono"
            />
          </div>
          <div>
            <Label htmlFor="secret_key">Secret Key</Label>
            <Input
              id="secret_key"
              type="password"
              value={config.secret_key || ''}
              onChange={(e) => updateField('secret_key', e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="endpoint">Custom Endpoint (optional)</Label>
          <Input
            id="endpoint"
            value={config.endpoint || ''}
            onChange={(e) => updateField('endpoint', e.target.value)}
            placeholder="https://s3.us-west-001.backblazeb2.com"
          />
          <p className="text-xs text-gray-500 mt-1">
            For Backblaze B2, Wasabi, MinIO, etc. Leave empty for AWS S3.
          </p>
        </div>
      </div>
    );
  }

  // Azure Blob
  if (storageType === 'cloud' && subtype === 'azure') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="account_name">Account Name</Label>
            <Input
              id="account_name"
              value={config.account_name || ''}
              onChange={(e) => updateField('account_name', e.target.value)}
              placeholder="mystorageaccount"
            />
          </div>
          <div>
            <Label htmlFor="container">Container</Label>
            <Input
              id="container"
              value={config.container || ''}
              onChange={(e) => updateField('container', e.target.value)}
              placeholder="media"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="account_key">Account Key</Label>
          <Input
            id="account_key"
            type="password"
            value={config.account_key || ''}
            onChange={(e) => updateField('account_key', e.target.value)}
            placeholder="••••••••"
          />
        </div>
      </div>
    );
  }

  // GCS
  if (storageType === 'cloud' && subtype === 'gcs') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="bucket">Bucket</Label>
            <Input
              id="bucket"
              value={config.bucket || ''}
              onChange={(e) => updateField('bucket', e.target.value)}
              placeholder="my-gcs-bucket"
            />
          </div>
          <div>
            <Label htmlFor="project_id">Project ID</Label>
            <Input
              id="project_id"
              value={config.project_id || ''}
              onChange={(e) => updateField('project_id', e.target.value)}
              placeholder="my-project-123"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="credentials_json">Service Account JSON</Label>
          <textarea
            id="credentials_json"
            value={config.credentials_json || ''}
            onChange={(e) => updateField('credentials_json', e.target.value)}
            placeholder='{"type": "service_account", ...}'
            className="w-full h-32 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm font-mono"
          />
        </div>
      </div>
    );
  }

  // OAuth providers (gdrive, onedrive, dropbox) - handled separately with OAuth flow
  if (storageType === 'cloud' && ['gdrive', 'onedrive', 'dropbox'].includes(subtype || '')) {
    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="folder_path">Folder Path (optional)</Label>
          <Input
            id="folder_path"
            value={config.folder_path || config.folder_id || ''}
            onChange={(e) => updateField(subtype === 'gdrive' ? 'folder_id' : 'folder_path', e.target.value)}
            placeholder="Verbatim Studio"
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave empty to use root folder.
          </p>
        </div>
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Click "Connect" below to authenticate with {
            subtype === 'gdrive' ? 'Google' :
            subtype === 'onedrive' ? 'Microsoft' :
            'Dropbox'
          }.
        </p>
      </div>
    );
  }

  return (
    <div className="text-gray-500 text-sm">
      Select a storage type and provider to configure.
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/storage/StorageConfigForm.tsx
git commit -m "feat: add StorageConfigForm with fields for all provider types

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This implementation plan covers **Phase 1: Foundation** of the storage location types feature:

1. **Task 1**: Database migration for subtype/status columns
2. **Task 2**: Encryption service for credentials
3. **Task 3**: Storage adapter base class and exceptions
4. **Task 4**: LocalAdapter implementation
5. **Task 5**: Adapter factory with registry
6. **Task 6**: Updated API routes with test endpoint
7. **Task 7**: Frontend TypeScript types
8. **Task 8**: Storage type selector component
9. **Task 9**: Storage subtype selector component
10. **Task 10**: Storage config form component

**Remaining phases** (to be planned separately):
- Phase 2: SMBAdapter and NFSAdapter
- Phase 3: S3Adapter
- Phase 4: OAuth providers (GDrive, OneDrive, Dropbox)
- Phase 5: Azure and GCS adapters
- Phase 6: Health checks and UI polish
