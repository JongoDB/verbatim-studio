"""Storage location management endpoints."""

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from persistence.database import async_session, get_db
from persistence.models import Document, Project, Recording, StorageLocation
from services.encryption import encrypt_config, SENSITIVE_FIELDS
from storage import StorageError, StorageAuthError, StorageUnavailableError
from storage.factory import get_adapter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-locations", tags=["storage-locations"])

# Track migration progress in memory (for simplicity)
_migration_progress: dict[str, dict] = {}

# Track cross-location transfer progress
_transfer_progress: dict[str, dict] = {}


class TransferRequest(BaseModel):
    """Request to transfer files between storage locations."""

    from_location_id: str
    to_location_id: str
    mode: str  # "copy" or "move"


class TransferStatus(BaseModel):
    """Cross-location transfer progress status."""

    status: str  # "running", "completed", "failed"
    total_files: int
    transferred_files: int
    current_file: str | None
    error: str | None


class StorageLocationConfig(BaseModel):
    """Storage location configuration (varies by type)."""

    # Local storage
    path: str | None = None

    # Network storage (SMB/NFS)
    server: str | None = None
    share: str | None = None
    username: str | None = None
    password: str | None = None
    domain: str | None = None
    mount_path: str | None = None

    # Cloud storage (S3/Azure/GCS)
    bucket: str | None = None
    region: str | None = None
    prefix: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    endpoint_url: str | None = None

    # Azure-specific
    account_name: str | None = None
    account_key: str | None = None
    container: str | None = None
    connection_string: str | None = None

    # Google Cloud-specific
    project_id: str | None = None
    credentials_json: str | None = None

    # OAuth tokens for cloud providers (gdrive, onedrive, dropbox)
    oauth_tokens: dict | None = None
    folder_id: str | None = None
    folder_path: str | None = None


def mask_sensitive_config(config: dict) -> dict:
    """Mask sensitive fields in config for API responses."""
    if not config:
        return config

    result = {}
    for key, value in config.items():
        if key in SENSITIVE_FIELDS and value is not None:
            # For dict fields like oauth_tokens, use a marker dict
            # For string fields, use masked string
            if isinstance(value, dict):
                result[key] = {"_masked": True}
            else:
                result[key] = "********"
        else:
            result[key] = value
    return result


class StorageLocationResponse(BaseModel):
    """Storage location response model."""

    id: str
    name: str
    type: str
    subtype: str | None = None
    status: str | None = None
    config: StorageLocationConfig
    is_default: bool
    is_active: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, loc: StorageLocation) -> "StorageLocationResponse":
        # Mask sensitive fields in the config
        masked_config = mask_sensitive_config(loc.config or {})
        return cls(
            id=loc.id,
            name=loc.name,
            type=loc.type,
            subtype=getattr(loc, 'subtype', None),
            status=getattr(loc, 'status', None),
            config=StorageLocationConfig(**masked_config),
            is_default=loc.is_default,
            is_active=loc.is_active,
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


class TestConnectionRequest(BaseModel):
    """Request to test a storage connection."""

    type: str
    subtype: str | None = None
    config: StorageLocationConfig


class TestConnectionResponse(BaseModel):
    """Response from testing a storage connection."""

    success: bool
    error: str | None = None
    latency_ms: float | None = None


class StorageLocationUpdate(BaseModel):
    """Update a storage location."""

    name: str | None = None
    config: StorageLocationConfig | None = None
    is_default: bool | None = None
    is_active: bool | None = None


@router.post("/test", response_model=TestConnectionResponse)
async def test_connection(body: TestConnectionRequest) -> TestConnectionResponse:
    """Test a storage connection before saving."""

    class MockLocation:
        """Mock location object for testing connections."""

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


@router.get("", response_model=StorageLocationListResponse)
async def list_storage_locations() -> StorageLocationListResponse:
    """List all storage locations."""
    async with async_session() as session:
        result = await session.execute(
            select(StorageLocation).order_by(StorageLocation.created_at)
        )
        locations = result.scalars().all()

        return StorageLocationListResponse(
            items=[StorageLocationResponse.from_model(loc) for loc in locations],
            total=len(locations),
        )


@router.post("/transfer", response_model=TransferStatus)
async def start_transfer(body: TransferRequest) -> TransferStatus:
    """Start transferring files between storage locations.

    Uses storage adapters so this works across any combination of
    local, GDrive, OneDrive, Dropbox locations.
    """
    if body.mode not in ("copy", "move"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mode must be 'copy' or 'move'",
        )

    # Check if transfer already running
    if _transfer_progress.get("current", {}).get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Transfer already in progress",
        )

    async with async_session() as session:
        from_loc = await session.get(StorageLocation, body.from_location_id)
        to_loc = await session.get(StorageLocation, body.to_location_id)

        if not from_loc:
            raise HTTPException(status_code=404, detail="Source location not found")
        if not to_loc:
            raise HTTPException(status_code=404, detail="Destination location not found")

        # Count files to transfer
        rec_count = await session.scalar(
            select(func.count(Recording.id)).where(
                Recording.storage_location_id == body.from_location_id
            )
        ) or 0
        doc_count = await session.scalar(
            select(func.count(Document.id)).where(
                Document.storage_location_id == body.from_location_id
            )
        ) or 0

    total_files = rec_count + doc_count

    if total_files == 0:
        return TransferStatus(
            status="completed",
            total_files=0,
            transferred_files=0,
            current_file=None,
            error=None,
        )

    # Initialize progress
    _transfer_progress["current"] = {
        "status": "running",
        "total_files": total_files,
        "transferred_files": 0,
        "current_file": None,
        "error": None,
    }

    # Start background transfer
    asyncio.create_task(
        _run_cross_location_transfer(
            body.from_location_id, body.to_location_id, body.mode
        )
    )

    return TransferStatus(
        status="running",
        total_files=total_files,
        transferred_files=0,
        current_file=None,
        error=None,
    )


@router.get("/transfer/status", response_model=TransferStatus)
async def get_transfer_status() -> TransferStatus:
    """Get current cross-location transfer status."""
    progress = _transfer_progress.get("current", {})

    if not progress:
        return TransferStatus(
            status="completed",
            total_files=0,
            transferred_files=0,
            current_file=None,
            error=None,
        )

    return TransferStatus(
        status=progress.get("status", "completed"),
        total_files=progress.get("total_files", 0),
        transferred_files=progress.get("transferred_files", 0),
        current_file=progress.get("current_file"),
        error=progress.get("error"),
    )


@router.get("/{location_id}", response_model=StorageLocationResponse)
async def get_storage_location(location_id: str) -> StorageLocationResponse:
    """Get a storage location by ID."""
    async with async_session() as session:
        result = await session.execute(
            select(StorageLocation).where(StorageLocation.id == location_id)
        )
        location = result.scalar_one_or_none()

        if not location:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Storage location not found: {location_id}",
            )

        return StorageLocationResponse.from_model(location)


@router.post("", response_model=StorageLocationResponse, status_code=status.HTTP_201_CREATED)
async def create_storage_location(body: StorageLocationCreate) -> StorageLocationResponse:
    """Create a new storage location."""
    # Validate local path exists
    if body.type == "local" and body.config.path:
        path = Path(body.config.path)
        # Require absolute paths for local storage to avoid ambiguity
        if not path.is_absolute():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path must be absolute (e.g., /Users/you/Documents/verbatim), got: {body.config.path}",
            )
        if not path.exists():
            # Try to create it
            try:
                path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot create directory: {e}",
                )

    async with async_session() as session:
        # If this is being set as default, unset current default
        if body.is_default:
            await session.execute(
                update(StorageLocation)
                .where(StorageLocation.is_default == True)
                .values(is_default=False)
            )

        # Encrypt sensitive fields in config before storing
        raw_config = body.config.model_dump(exclude_none=True)
        encrypted_config = encrypt_config(raw_config)

        location = StorageLocation(
            name=body.name,
            type=body.type,
            subtype=body.subtype,
            config=encrypted_config,
            is_default=body.is_default,
            is_active=True,
        )
        session.add(location)
        await session.commit()
        await session.refresh(location)

        return StorageLocationResponse.from_model(location)


@router.put("/{location_id}", response_model=StorageLocationResponse)
async def update_storage_location(
    location_id: str, body: StorageLocationUpdate
) -> StorageLocationResponse:
    """Update a storage location."""
    async with async_session() as session:
        result = await session.execute(
            select(StorageLocation).where(StorageLocation.id == location_id)
        )
        location = result.scalar_one_or_none()

        if not location:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Storage location not found: {location_id}",
            )

        # Update fields
        if body.name is not None:
            location.name = body.name

        if body.config is not None:
            # Validate local path exists
            if location.type == "local" and body.config.path:
                path = Path(body.config.path)
                # Require absolute paths for local storage to avoid ambiguity
                if not path.is_absolute():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Path must be absolute (e.g., /Users/you/Documents/verbatim), got: {body.config.path}",
                    )
                if not path.exists():
                    try:
                        path.mkdir(parents=True, exist_ok=True)
                    except Exception as e:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot create directory: {e}",
                        )
            # Encrypt sensitive fields before storing, preserving existing
            # encrypted values when the frontend sends back masked placeholders
            raw_config = body.config.model_dump(exclude_none=True)
            existing_config = location.config or {}

            # For each sensitive field, check if the frontend sent a masked
            # placeholder ({"_masked": True}) — if so, preserve the existing
            # encrypted value from the DB rather than re-encrypting the mask
            preserved_encrypted = {}
            for field_name in SENSITIVE_FIELDS:
                new_value = raw_config.get(field_name)
                if isinstance(new_value, dict) and new_value.get("_masked"):
                    existing_value = existing_config.get(field_name)
                    if existing_value is not None:
                        preserved_encrypted[field_name] = existing_value
                    raw_config.pop(field_name, None)

            encrypted_config = encrypt_config(raw_config)
            encrypted_config.update(preserved_encrypted)
            location.config = encrypted_config

        if body.is_active is not None:
            location.is_active = body.is_active

        if body.is_default is not None:
            if body.is_default and not location.is_default:
                # Unset current default
                await session.execute(
                    update(StorageLocation)
                    .where(StorageLocation.id != location_id)
                    .where(StorageLocation.is_default == True)
                    .values(is_default=False)
                )
            location.is_default = body.is_default

        await session.commit()
        await session.refresh(location)

        return StorageLocationResponse.from_model(location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_storage_location(location_id: str) -> None:
    """Delete a storage location.

    Cannot delete if it's the only active location.
    """
    async with async_session() as session:
        result = await session.execute(
            select(StorageLocation).where(StorageLocation.id == location_id)
        )
        location = result.scalar_one_or_none()

        if not location:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Storage location not found: {location_id}",
            )

        # Check if this is the only location
        count_result = await session.execute(select(StorageLocation))
        all_locations = count_result.scalars().all()
        if len(all_locations) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the only storage location",
            )

        # If deleting default, make another one default
        if location.is_default:
            for other in all_locations:
                if other.id != location_id and other.is_active:
                    other.is_default = True
                    break

        await session.delete(location)
        await session.commit()


class MigrationRequest(BaseModel):
    """Request to migrate files to a new location."""

    source_path: str
    destination_path: str


class MigrationStatus(BaseModel):
    """Migration progress status."""

    status: str  # "pending", "running", "completed", "failed"
    total_files: int
    migrated_files: int
    total_bytes: int
    migrated_bytes: int
    current_file: str | None
    error: str | None


@router.post("/migrate", response_model=MigrationStatus)
async def start_migration(body: MigrationRequest) -> MigrationStatus:
    """Start migrating files from source to destination path.

    This runs in the background and returns immediately.
    Use GET /migrate/status to check progress.
    """
    source = Path(body.source_path)
    destination = Path(body.destination_path)

    if not source.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source path does not exist: {source}",
        )

    if source == destination:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and destination are the same",
        )

    # Create destination if needed
    try:
        destination.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot create destination: {e}",
        )

    # Check if migration already running
    if _migration_progress.get("current", {}).get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Migration already in progress",
        )

    # Calculate total files and size - scan ALL files in source directory
    # Files can be in: root (no project), project folders, recordings/, documents/
    files_to_migrate = []
    total_bytes = 0

    for file_path in source.rglob("*"):
        if file_path.is_file():
            files_to_migrate.append(file_path)
            total_bytes += file_path.stat().st_size

    # Initialize progress
    _migration_progress["current"] = {
        "status": "running",
        "total_files": len(files_to_migrate),
        "migrated_files": 0,
        "total_bytes": total_bytes,
        "migrated_bytes": 0,
        "current_file": None,
        "error": None,
        "source": str(source),
        "destination": str(destination),
        "files": files_to_migrate,
    }

    # Start migration in background
    asyncio.create_task(_run_migration(source, destination, files_to_migrate))

    return MigrationStatus(
        status="running",
        total_files=len(files_to_migrate),
        migrated_files=0,
        total_bytes=total_bytes,
        migrated_bytes=0,
        current_file=None,
        error=None,
    )


async def _run_migration(source: Path, destination: Path, files: list[Path]) -> None:
    """Run the migration in the background."""
    progress = _migration_progress["current"]

    try:
        for file_path in files:
            # Calculate relative path from source
            relative_path = file_path.relative_to(source)
            dest_path = destination / relative_path

            progress["current_file"] = str(relative_path)

            # Create destination directory
            dest_path.parent.mkdir(parents=True, exist_ok=True)

            # Copy file (using sync shutil in executor to not block)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, shutil.copy2, file_path, dest_path)

            # Update progress
            file_size = file_path.stat().st_size
            progress["migrated_files"] += 1
            progress["migrated_bytes"] += file_size

            # Small delay to allow status checks
            await asyncio.sleep(0.01)

        # Migration complete - clean up source files that were migrated
        loop = asyncio.get_event_loop()
        for file_path in files:
            try:
                if file_path.exists():
                    await loop.run_in_executor(None, file_path.unlink)
            except Exception as e:
                logger.warning(f"Could not remove source file {file_path}: {e}")

        # Clean up empty directories in source (bottom-up)
        for dir_path in sorted(source.rglob("*"), key=lambda p: len(p.parts), reverse=True):
            if dir_path.is_dir():
                try:
                    dir_path.rmdir()  # Only removes if empty
                except OSError:
                    pass  # Directory not empty, skip

        # Update database file paths to point to new location
        progress["current_file"] = "Updating database records..."
        await _update_database_paths(source, destination)

        progress["status"] = "completed"
        progress["current_file"] = None
        logger.info(f"Migration completed: {progress['migrated_files']} files, {progress['migrated_bytes']} bytes")

    except Exception as e:
        progress["status"] = "failed"
        progress["error"] = str(e)
        logger.exception("Migration failed")


async def _update_database_paths(source: Path, destination: Path) -> None:
    """Update file paths and storage_location_id in database after migration.

    Replaces source path prefix with destination path prefix in all
    Document and Recording file_path fields, and updates storage_location_id
    to point to the new active storage location.
    """
    source_str = str(source)
    dest_str = str(destination)

    async with async_session() as session:
        # Get the new active storage location (the one we're migrating TO)
        new_location_result = await session.execute(
            select(StorageLocation).where(
                StorageLocation.is_default == True,
                StorageLocation.is_active == True,
            )
        )
        new_location = new_location_result.scalar_one_or_none()
        new_location_id = new_location.id if new_location else None

        # Update Documents
        doc_result = await session.execute(select(Document))
        for doc in doc_result.scalars():
            if doc.file_path and doc.file_path.startswith(source_str):
                doc.file_path = doc.file_path.replace(source_str, dest_str, 1)
                if new_location_id:
                    doc.storage_location_id = new_location_id
                logger.debug(f"Updated document {doc.id} path to {doc.file_path}")

        # Update Recordings
        rec_result = await session.execute(select(Recording))
        for rec in rec_result.scalars():
            if rec.file_path and rec.file_path.startswith(source_str):
                rec.file_path = rec.file_path.replace(source_str, dest_str, 1)
                if new_location_id:
                    rec.storage_location_id = new_location_id
                logger.debug(f"Updated recording {rec.id} path to {rec.file_path}")

        await session.commit()
        logger.info(f"Updated database paths from {source_str} to {dest_str}, storage_location_id to {new_location_id}")


@router.get("/migrate/status", response_model=MigrationStatus)
async def get_migration_status() -> MigrationStatus:
    """Get current migration status."""
    progress = _migration_progress.get("current", {})

    if not progress:
        return MigrationStatus(
            status="idle",
            total_files=0,
            migrated_files=0,
            total_bytes=0,
            migrated_bytes=0,
            current_file=None,
            error=None,
        )

    return MigrationStatus(
        status=progress.get("status", "idle"),
        total_files=progress.get("total_files", 0),
        migrated_files=progress.get("migrated_files", 0),
        total_bytes=progress.get("total_bytes", 0),
        migrated_bytes=progress.get("migrated_bytes", 0),
        current_file=progress.get("current_file"),
        error=progress.get("error"),
    )


@router.get("/{location_id}/file-count")
async def get_location_file_count(location_id: str) -> dict:
    """Get count of files stored in a specific location."""
    async with async_session() as session:
        rec_count = await session.scalar(
            select(func.count(Recording.id)).where(
                Recording.storage_location_id == location_id
            )
        )
        doc_count = await session.scalar(
            select(func.count(Document.id)).where(
                Document.storage_location_id == location_id
            )
        )
    return {"recordings": rec_count or 0, "documents": doc_count or 0}


async def _run_cross_location_transfer(
    from_location_id: str, to_location_id: str, mode: str
) -> None:
    """Transfer files between storage locations using adapters.

    Works across any combination of local/cloud locations.
    """
    progress = _transfer_progress["current"]

    try:
        async with async_session() as session:
            from_loc = await session.get(StorageLocation, from_location_id)
            to_loc = await session.get(StorageLocation, to_location_id)

            if not from_loc or not to_loc:
                progress["status"] = "failed"
                progress["error"] = "Storage location not found"
                return

            from_adapter = get_adapter(from_loc)
            to_adapter = get_adapter(to_loc)

            from_base_path = from_loc.config.get("path", "") if from_loc.type == "local" else ""
            to_base_path = to_loc.config.get("path", "") if to_loc.type == "local" else ""

            # Get all recordings from source location
            rec_result = await session.execute(
                select(Recording).where(
                    Recording.storage_location_id == from_location_id
                )
            )
            recordings = list(rec_result.scalars().all())

            # Get all documents from source location
            doc_result = await session.execute(
                select(Document).where(
                    Document.storage_location_id == from_location_id
                )
            )
            documents = list(doc_result.scalars().all())

            # Transfer recordings
            for rec in recordings:
                try:
                    progress["current_file"] = rec.file_name

                    # Compute source and destination paths
                    src_path = rec.file_path
                    relative_path = _compute_relative_path(src_path, from_loc)
                    dest_path = _compute_dest_path(relative_path, to_loc, to_base_path)

                    # Read from source, write to destination
                    data = await from_adapter.read_file(src_path if from_loc.type == "cloud" else src_path)
                    await to_adapter.write_file(dest_path if to_loc.type == "cloud" else dest_path, data)

                    # Update DB record
                    rec.file_path = dest_path
                    rec.storage_location_id = to_location_id

                    # Delete source if moving
                    if mode == "move":
                        try:
                            await from_adapter.delete_file(src_path if from_loc.type == "cloud" else src_path)
                        except Exception as e:
                            logger.warning(f"Could not delete source file {src_path}: {e}")

                    progress["transferred_files"] += 1
                    await asyncio.sleep(0.01)

                except Exception as e:
                    logger.error(f"Failed to transfer recording {rec.file_name}: {e}")
                    progress["status"] = "failed"
                    progress["error"] = f"Failed to transfer {rec.file_name}: {e}"
                    await session.commit()
                    return

            # Transfer documents
            for doc in documents:
                try:
                    progress["current_file"] = doc.filename

                    src_path = doc.file_path
                    relative_path = _compute_relative_path(src_path, from_loc)
                    dest_path = _compute_dest_path(relative_path, to_loc, to_base_path)

                    data = await from_adapter.read_file(src_path if from_loc.type == "cloud" else src_path)
                    await to_adapter.write_file(dest_path if to_loc.type == "cloud" else dest_path, data)

                    doc.file_path = dest_path
                    doc.storage_location_id = to_location_id

                    if mode == "move":
                        try:
                            await from_adapter.delete_file(src_path if from_loc.type == "cloud" else src_path)
                        except Exception as e:
                            logger.warning(f"Could not delete source file {src_path}: {e}")

                    progress["transferred_files"] += 1
                    await asyncio.sleep(0.01)

                except Exception as e:
                    logger.error(f"Failed to transfer document {doc.filename}: {e}")
                    progress["status"] = "failed"
                    progress["error"] = f"Failed to transfer {doc.filename}: {e}"
                    await session.commit()
                    return

            await session.commit()

        progress["status"] = "completed"
        progress["current_file"] = None
        logger.info(
            f"Transfer completed: {progress['transferred_files']} files "
            f"({'moved' if mode == 'move' else 'copied'})"
        )

    except Exception as e:
        progress["status"] = "failed"
        progress["error"] = str(e)
        logger.exception("Cross-location transfer failed")


def _compute_relative_path(file_path: str, location: StorageLocation) -> str:
    """Extract relative path from an absolute/cloud file path."""
    if location.type == "local":
        base = location.config.get("path", "")
        if base and file_path.startswith(base):
            rel = file_path[len(base):]
            return rel.lstrip("/").lstrip("\\")
        return Path(file_path).name
    else:
        # Cloud paths are already relative
        return file_path


def _compute_dest_path(
    relative_path: str, to_location: StorageLocation, to_base_path: str
) -> str:
    """Compute destination path from a relative path."""
    if to_location.type == "local":
        return str(Path(to_base_path) / relative_path)
    else:
        # Cloud destinations use relative paths directly
        return relative_path


class SyncResult(BaseModel):
    """Result of a storage sync operation."""

    recordings_in_db: int
    recordings_on_disk: int
    recordings_imported: int
    recordings_removed: int = 0
    documents_in_db: int
    documents_on_disk: int
    documents_imported: int
    documents_removed: int = 0
    projects_created: int = 0
    projects_removed: int = 0
    storage_location_id: str
    storage_location_name: str
    storage_path: str


# MIME type mappings
AUDIO_VIDEO_MIME_TYPES = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
}

DOCUMENT_MIME_TYPES = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.tiff': 'image/tiff',
}


@router.post("/sync", response_model=SyncResult)
async def sync_storage(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SyncResult:
    """Sync workspace with active storage location.

    Storage-as-truth model:
    - Folders become projects (auto-created if missing)
    - Files become recordings/documents (imported if new)
    - DB records removed if file no longer exists on storage
    - Files assigned to their parent folder's project
    """
    from sqlalchemy import delete

    # Get active storage location
    result = await db.execute(
        select(StorageLocation).where(
            StorageLocation.is_default == True,
            StorageLocation.is_active == True,
        )
    )
    location = result.scalar_one_or_none()

    if not location:
        raise HTTPException(status_code=404, detail="No active storage location found")

    # Get storage path
    storage_path = None
    if location.type == "local":
        storage_path = location.config.get("path")
    elif location.type == "cloud":
        storage_path = location.config.get("folder_path", "Cloud Storage")

    if not storage_path:
        raise HTTPException(status_code=400, detail="Storage location has no path configured")

    storage_dir = Path(storage_path) if location.type == "local" else None

    # Get existing data from database
    all_rec_result = await db.execute(select(Recording).where(Recording.storage_location_id == location.id))
    existing_recordings = {rec.file_path: rec for rec in all_rec_result.scalars().all() if rec.file_path}

    all_doc_result = await db.execute(select(Document).where(Document.storage_location_id == location.id))
    existing_documents = {doc.file_path: doc for doc in all_doc_result.scalars().all() if doc.file_path}

    all_proj_result = await db.execute(select(Project))
    existing_projects = {proj.name: proj for proj in all_proj_result.scalars().all()}

    # Track what we find on storage
    found_file_paths: set[str] = set()
    found_folder_names: set[str] = set()

    # Track counts
    recordings_on_disk = 0
    documents_on_disk = 0
    recordings_imported = 0
    documents_imported = 0
    recordings_removed = 0
    documents_removed = 0
    projects_created = 0
    projects_removed = 0

    # Helper to get or create a project for a folder
    def get_or_create_project(folder_name: str) -> Project | None:
        nonlocal projects_created
        if not folder_name:
            return None

        found_folder_names.add(folder_name)

        if folder_name in existing_projects:
            return existing_projects[folder_name]

        # Create new project
        new_project = Project(name=folder_name)
        db.add(new_project)
        existing_projects[folder_name] = new_project
        projects_created += 1
        logger.info(f"Created project from folder: {folder_name}")
        return new_project

    # Helper function to process a file
    def process_file(
        file_path: str,
        file_name: str,
        file_size: int,
        ext: str,
        parent_folder: str | None,
    ) -> None:
        nonlocal recordings_on_disk, documents_on_disk, recordings_imported, documents_imported

        found_file_paths.add(file_path)

        # Get or create project for parent folder
        project = get_or_create_project(parent_folder) if parent_folder else None

        if ext in AUDIO_VIDEO_MIME_TYPES:
            recordings_on_disk += 1

            if file_path in existing_recordings:
                # Record exists - update project assignment if needed
                existing = existing_recordings[file_path]
                if project and existing.project_id != (project.id if hasattr(project, 'id') and project.id else None):
                    existing.project_id = project.id if hasattr(project, 'id') else None
            else:
                # New file - import it
                try:
                    title = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
                    new_recording = Recording(
                        title=title,
                        file_path=file_path,
                        file_name=file_name,
                        file_size=file_size,
                        mime_type=AUDIO_VIDEO_MIME_TYPES.get(ext, 'application/octet-stream'),
                        storage_location_id=location.id,
                        project_id=project.id if project and hasattr(project, 'id') else None,
                        status="pending",
                    )
                    db.add(new_recording)
                    recordings_imported += 1
                    existing_recordings[file_path] = new_recording
                    logger.info(f"Imported recording: {file_name}")
                except Exception as e:
                    logger.error(f"Failed to import recording {file_path}: {e}")

        elif ext in DOCUMENT_MIME_TYPES:
            documents_on_disk += 1

            if file_path in existing_documents:
                # Record exists - update project assignment if needed
                existing = existing_documents[file_path]
                if project and existing.project_id != (project.id if hasattr(project, 'id') and project.id else None):
                    existing.project_id = project.id if hasattr(project, 'id') else None
            else:
                # New file - import it
                try:
                    title = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
                    new_document = Document(
                        title=title,
                        filename=file_name,
                        file_path=file_path,
                        mime_type=DOCUMENT_MIME_TYPES.get(ext, 'application/octet-stream'),
                        file_size_bytes=file_size,
                        storage_location_id=location.id,
                        project_id=project.id if project and hasattr(project, 'id') else None,
                        status="pending",
                    )
                    db.add(new_document)
                    documents_imported += 1
                    existing_documents[file_path] = new_document
                    logger.info(f"Imported document: {file_name}")
                except Exception as e:
                    logger.error(f"Failed to import document {file_path}: {e}")

    # Helper to extract parent folder from path
    def get_parent_folder(file_path: str, is_cloud: bool) -> str | None:
        if is_cloud:
            # Cloud paths like "ProjectName/file.mp3"
            parts = file_path.split("/")
            return parts[0] if len(parts) > 1 else None
        else:
            # Local paths - get first directory under storage root
            try:
                rel_path = Path(file_path).relative_to(storage_dir)
                parts = rel_path.parts
                return parts[0] if len(parts) > 1 else None
            except ValueError:
                return None

    if location.type == "cloud":
        # Cloud storage - use adapter to scan
        try:
            adapter = get_adapter(location)

            # Recursive function to scan cloud directories
            async def scan_cloud_directory(path: str = "") -> None:
                try:
                    files = await adapter.list_files(path)
                    for file_info in files:
                        if file_info.is_directory:
                            # Track folder as potential project
                            # Only top-level folders become projects
                            if "/" not in file_info.path:
                                found_folder_names.add(file_info.name)
                            # Recursively scan subdirectories
                            await scan_cloud_directory(file_info.path)
                        else:
                            # Process the file
                            ext = ("." + file_info.name.rsplit(".", 1)[1]).lower() if "." in file_info.name else ""
                            parent = get_parent_folder(file_info.path, is_cloud=True)
                            process_file(
                                file_path=file_info.path,
                                file_name=file_info.name,
                                file_size=file_info.size,
                                ext=ext,
                                parent_folder=parent,
                            )
                except Exception as e:
                    logger.warning(f"Failed to scan cloud directory {path}: {e}")

            # Start scanning from root
            await scan_cloud_directory("")
            logger.info(f"Cloud sync scanned storage: found {recordings_on_disk} recordings, {documents_on_disk} documents")

        except Exception as e:
            logger.error(f"Failed to sync cloud storage: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to sync cloud storage: {str(e)}")

    elif storage_dir and storage_dir.exists():
        # Local storage - scan filesystem
        for file_path in storage_dir.rglob("*"):
            if file_path.is_dir():
                # Track top-level folders as potential projects
                try:
                    rel = file_path.relative_to(storage_dir)
                    if len(rel.parts) == 1:
                        found_folder_names.add(file_path.name)
                except ValueError:
                    pass
            elif file_path.is_file():
                ext = file_path.suffix.lower()
                file_str = str(file_path)
                try:
                    stat = file_path.stat()
                    parent = get_parent_folder(file_str, is_cloud=False)
                    process_file(
                        file_path=file_str,
                        file_name=file_path.name,
                        file_size=stat.st_size,
                        ext=ext,
                        parent_folder=parent,
                    )
                except Exception as e:
                    logger.error(f"Failed to process local file {file_path}: {e}")

    # Remove DB records for files no longer on storage
    for file_path, recording in list(existing_recordings.items()):
        if file_path not in found_file_paths:
            await db.delete(recording)
            recordings_removed += 1
            logger.info(f"Removed recording (file deleted from storage): {recording.title}")

    for file_path, document in list(existing_documents.items()):
        if file_path not in found_file_paths:
            await db.delete(document)
            documents_removed += 1
            logger.info(f"Removed document (file deleted from storage): {document.title}")

    # Commit all changes
    await db.commit()

    # Calculate final counts
    final_recordings = recordings_on_disk
    final_documents = documents_on_disk

    logger.info(
        f"Sync complete: {recordings_imported} recordings imported, {recordings_removed} removed; "
        f"{documents_imported} documents imported, {documents_removed} removed; "
        f"{projects_created} projects created"
    )

    return SyncResult(
        recordings_in_db=final_recordings,
        recordings_on_disk=recordings_on_disk,
        recordings_imported=recordings_imported,
        recordings_removed=recordings_removed,
        documents_in_db=final_documents,
        documents_on_disk=documents_on_disk,
        documents_imported=documents_imported,
        documents_removed=documents_removed,
        projects_created=projects_created,
        projects_removed=projects_removed,
        storage_location_id=location.id,
        storage_location_name=location.name,
        storage_path=storage_path,
    )
