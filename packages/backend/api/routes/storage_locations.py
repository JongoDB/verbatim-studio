"""Storage location management endpoints."""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from persistence.database import async_session
from persistence.models import StorageLocation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-locations", tags=["storage-locations"])


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
