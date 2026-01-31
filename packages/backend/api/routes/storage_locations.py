"""Storage location management endpoints."""

import asyncio
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from persistence.database import async_session
from persistence.models import StorageLocation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-locations", tags=["storage-locations"])

# Track migration progress in memory (for simplicity)
_migration_progress: dict[str, dict] = {}


class StorageLocationConfig(BaseModel):
    """Storage location configuration (varies by type)."""

    path: str | None = None  # For local storage
    # Future: bucket, region, credentials for cloud storage


class StorageLocationResponse(BaseModel):
    """Storage location response model."""

    id: str
    name: str
    type: str
    config: StorageLocationConfig
    is_default: bool
    is_active: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, loc: StorageLocation) -> "StorageLocationResponse":
        return cls(
            id=loc.id,
            name=loc.name,
            type=loc.type,
            config=StorageLocationConfig(**(loc.config or {})),
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
    config: StorageLocationConfig
    is_default: bool = False


class StorageLocationUpdate(BaseModel):
    """Update a storage location."""

    name: str | None = None
    config: StorageLocationConfig | None = None
    is_default: bool | None = None
    is_active: bool | None = None


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

        location = StorageLocation(
            name=body.name,
            type=body.type,
            config=body.config.model_dump(exclude_none=True),
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
            location.config = body.config.model_dump(exclude_none=True)

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

    # Calculate total files and size
    files_to_migrate = []
    total_bytes = 0

    for subdir in ["recordings", "documents"]:
        source_subdir = source / subdir
        if source_subdir.exists():
            for file_path in source_subdir.rglob("*"):
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

        # Migration complete - clean up source directories
        for subdir in ["recordings", "documents"]:
            source_subdir = source / subdir
            if source_subdir.exists():
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, shutil.rmtree, source_subdir)
                except Exception as e:
                    logger.warning(f"Could not remove source directory {source_subdir}: {e}")

        progress["status"] = "completed"
        progress["current_file"] = None
        logger.info(f"Migration completed: {progress['migrated_files']} files, {progress['migrated_bytes']} bytes")

    except Exception as e:
        progress["status"] = "failed"
        progress["error"] = str(e)
        logger.exception("Migration failed")


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
