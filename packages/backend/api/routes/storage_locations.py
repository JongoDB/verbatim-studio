"""Storage location management endpoints."""

import asyncio
import logging
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from persistence.database import async_session
from persistence.models import Document, Recording, StorageLocation
from services.encryption import encrypt_config, SENSITIVE_FIELDS
from storage import StorageError, StorageAuthError, StorageUnavailableError
from storage.factory import get_adapter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-locations", tags=["storage-locations"])

# Track migration progress in memory (for simplicity)
_migration_progress: dict[str, dict] = {}


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
                if not path.exists():
                    try:
                        path.mkdir(parents=True, exist_ok=True)
                    except Exception as e:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot create directory: {e}",
                        )
            # Encrypt sensitive fields before storing
            raw_config = body.config.model_dump(exclude_none=True)
            location.config = encrypt_config(raw_config)

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
    """Update file paths in database after migration.

    Replaces source path prefix with destination path prefix in all
    Document and Recording file_path fields.
    """
    source_str = str(source)
    dest_str = str(destination)

    async with async_session() as session:
        # Update Documents
        doc_result = await session.execute(select(Document))
        for doc in doc_result.scalars():
            if doc.file_path and doc.file_path.startswith(source_str):
                doc.file_path = doc.file_path.replace(source_str, dest_str, 1)
                logger.debug(f"Updated document {doc.id} path to {doc.file_path}")

        # Update Recordings
        rec_result = await session.execute(select(Recording))
        for rec in rec_result.scalars():
            if rec.file_path and rec.file_path.startswith(source_str):
                rec.file_path = rec.file_path.replace(source_str, dest_str, 1)
                logger.debug(f"Updated recording {rec.id} path to {rec.file_path}")

        await session.commit()
        logger.info(f"Updated database paths from {source_str} to {dest_str}")


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
