"""Job queue management endpoints."""

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from services.jobs import job_queue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


# Pydantic models for responses
class JobResponse(BaseModel):
    """Response model for a job."""

    id: str
    job_type: str
    status: str
    payload: dict = Field(default_factory=dict)
    result: dict | None = None
    error: str | None = None
    progress: float = 0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    """Response model for list of jobs."""

    items: list[JobResponse]
    total: int


class MessageResponse(BaseModel):
    """Response model for simple messages."""

    message: str
    id: str | None = None


def _job_to_response(job) -> JobResponse:
    """Convert a Job model to a response model."""
    return JobResponse(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        payload=job.payload or {},
        result=job.result,
        error=job.error,
        progress=job.progress,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


@router.get("", response_model=JobListResponse)
async def list_jobs(
    status_filter: Annotated[
        str | None,
        Query(alias="status", description="Filter by job status"),
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=1000, description="Maximum number of jobs to return"),
    ] = 100,
) -> JobListResponse:
    """List all jobs with optional status filter.

    Args:
        status_filter: Optional status filter (queued, running, completed, failed, cancelled).
        limit: Maximum number of jobs to return.

    Returns:
        List of jobs.
    """
    jobs = await job_queue.list_jobs(status=status_filter, limit=limit)

    return JobListResponse(
        items=[_job_to_response(job) for job in jobs],
        total=len(jobs),
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    """Get a job by ID.

    Args:
        job_id: The job's unique ID.

    Returns:
        Job details.

    Raises:
        HTTPException: If job not found.
    """
    job = await job_queue.get_job(job_id)

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    return _job_to_response(job)


@router.post("/{job_id}/cancel", response_model=MessageResponse)
async def cancel_job(job_id: str) -> MessageResponse:
    """Cancel a queued job.

    Only jobs in 'queued' status can be cancelled.

    Args:
        job_id: The job's unique ID.

    Returns:
        Confirmation message.

    Raises:
        HTTPException: If job not found or cannot be cancelled.
    """
    # First check if job exists
    job = await job_queue.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    # Try to cancel
    cancelled = await job_queue.cancel_job(job_id)

    if not cancelled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job cannot be cancelled (status: {job.status}). "
            "Only queued jobs can be cancelled.",
        )

    return MessageResponse(
        message="Job cancelled successfully",
        id=job_id,
    )


@router.post("/clear-completed", response_model=MessageResponse)
async def clear_completed_jobs() -> MessageResponse:
    """Clear all completed, failed, and cancelled jobs from the database.

    Returns:
        Confirmation message with count of deleted jobs.
    """
    count = await job_queue.clear_completed_jobs()
    return MessageResponse(
        message=f"Cleared {count} completed/failed/cancelled job(s)",
    )
