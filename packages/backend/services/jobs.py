"""Job queue service for async task processing."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update

from persistence.database import async_session
from persistence.models import Job, Recording, Segment, Transcript

logger = logging.getLogger(__name__)

# Type alias for job handlers
# Handler receives (payload, progress_callback) and returns result dict
ProgressCallback = Callable[[float], Awaitable[None]]
JobHandler = Callable[[dict[str, Any], ProgressCallback], Awaitable[dict[str, Any]]]


class JobQueue:
    """Job queue using ThreadPoolExecutor for async task processing."""

    def __init__(self, max_workers: int = 2):
        """Initialize the job queue.

        Args:
            max_workers: Maximum number of concurrent workers.
        """
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._handlers: dict[str, JobHandler] = {}
        self._futures: dict[str, Future] = {}
        logger.info("JobQueue initialized with max_workers=%d", max_workers)

    def register_handler(self, job_type: str, handler: JobHandler) -> None:
        """Register a handler for a job type.

        Args:
            job_type: The type of job this handler processes.
            handler: Async function that processes the job.
        """
        self._handlers[job_type] = handler
        logger.info("Registered handler for job type: %s", job_type)

    async def enqueue(self, job_type: str, payload: dict[str, Any]) -> str:
        """Create a job and submit it to the executor.

        Args:
            job_type: The type of job to create.
            payload: The job payload data.

        Returns:
            The job ID.

        Raises:
            ValueError: If no handler is registered for the job type.
        """
        if job_type not in self._handlers:
            raise ValueError(f"No handler registered for job type: {job_type}")

        # Create job record in database
        async with async_session() as session:
            job = Job(
                job_type=job_type,
                status="queued",
                payload=payload,
                progress=0,
            )
            session.add(job)
            await session.commit()
            job_id = job.id
            logger.info("Created job %s of type %s", job_id, job_type)

        # Submit to executor
        future = self._executor.submit(self._run_job_sync, job_id)
        self._futures[job_id] = future

        return job_id

    def _run_job_sync(self, job_id: str) -> None:
        """Synchronous wrapper to run job in thread pool.

        This runs in the executor thread and creates a new event loop
        for async operations.

        Args:
            job_id: The job ID to process.
        """
        # Create a new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._run_job(job_id))
        finally:
            loop.close()

    async def _run_job(self, job_id: str) -> None:
        """Execute a job and update its status.

        Args:
            job_id: The job ID to process.
        """
        logger.info("Starting job %s", job_id)

        # Mark job as running
        async with async_session() as session:
            await session.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(status="running", started_at=datetime.now(UTC))
            )
            await session.commit()

        try:
            # Get job details
            async with async_session() as session:
                result = await session.execute(select(Job).where(Job.id == job_id))
                job = result.scalar_one_or_none()

                if job is None:
                    logger.error("Job %s not found", job_id)
                    return

                if job.status == "cancelled":
                    logger.info("Job %s was cancelled, skipping", job_id)
                    return

                job_type = job.job_type
                payload = job.payload

            # Get handler
            handler = self._handlers.get(job_type)
            if handler is None:
                raise ValueError(f"No handler registered for job type: {job_type}")

            # Create progress callback
            async def update_progress(progress: float) -> None:
                """Update job progress in database."""
                async with async_session() as session:
                    await session.execute(
                        update(Job).where(Job.id == job_id).values(progress=progress)
                    )
                    await session.commit()

            # Execute handler
            result = await handler(payload, update_progress)

            # Mark job as completed
            async with async_session() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="completed",
                        result=result,
                        progress=100,
                        completed_at=datetime.now(UTC),
                    )
                )
                await session.commit()
            logger.info("Job %s completed successfully", job_id)

        except Exception as e:
            logger.exception("Job %s failed with error", job_id)
            # Mark job as failed
            async with async_session() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        error=str(e),
                        completed_at=datetime.now(UTC),
                    )
                )
                await session.commit()

        finally:
            # Clean up future reference
            self._futures.pop(job_id, None)

    async def get_job(self, job_id: str) -> Job | None:
        """Get a job by ID.

        Args:
            job_id: The job ID to retrieve.

        Returns:
            The job record or None if not found.
        """
        async with async_session() as session:
            result = await session.execute(select(Job).where(Job.id == job_id))
            return result.scalar_one_or_none()

    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a queued job.

        Only jobs in 'queued' status can be cancelled.

        Args:
            job_id: The job ID to cancel.

        Returns:
            True if job was cancelled, False if not found or not cancellable.
        """
        async with async_session() as session:
            result = await session.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one_or_none()

            if job is None:
                return False

            if job.status != "queued":
                return False

            # Update status to cancelled
            await session.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(status="cancelled", completed_at=datetime.now(UTC))
            )
            await session.commit()

            # Try to cancel the future if it exists
            future = self._futures.pop(job_id, None)
            if future is not None:
                future.cancel()

            logger.info("Job %s cancelled", job_id)
            return True

    async def list_jobs(self, status: str | None = None, limit: int = 100) -> list[Job]:
        """List jobs with optional status filter.

        Args:
            status: Optional status filter.
            limit: Maximum number of jobs to return.

        Returns:
            List of jobs.
        """
        async with async_session() as session:
            query = select(Job).order_by(Job.created_at.desc()).limit(limit)
            if status is not None:
                query = query.where(Job.status == status)
            result = await session.execute(query)
            return list(result.scalars().all())

    def shutdown(self, wait: bool = True) -> None:
        """Shutdown the executor gracefully.

        Args:
            wait: Whether to wait for pending jobs to complete.
        """
        logger.info("Shutting down JobQueue (wait=%s)", wait)
        self._executor.shutdown(wait=wait)
        self._futures.clear()


# Default job queue instance
job_queue = JobQueue()


async def handle_transcription(
    payload: dict[str, Any], progress_callback: ProgressCallback
) -> dict[str, Any]:
    """Handle transcription job.

    Args:
        payload: Job payload with 'recording_id' and optional 'language'.
        progress_callback: Callback to report progress.

    Returns:
        Result dictionary with transcript_id and segment count.

    Raises:
        ValueError: If recording not found or invalid.
    """
    from services.transcription import transcription_service

    recording_id = payload.get("recording_id")
    language = payload.get("language")

    if not recording_id:
        raise ValueError("Missing recording_id in payload")

    # Get recording and update status
    async with async_session() as session:
        result = await session.execute(select(Recording).where(Recording.id == recording_id))
        recording = result.scalar_one_or_none()

        if recording is None:
            raise ValueError(f"Recording not found: {recording_id}")

        # Update recording status to processing
        await session.execute(
            update(Recording).where(Recording.id == recording_id).values(status="processing")
        )
        await session.commit()
        audio_path = recording.file_path

    try:
        # Run transcription
        transcription_result = await transcription_service.transcribe(
            audio_path=audio_path,
            language=language,
            progress_callback=progress_callback,
        )

        detected_language = transcription_result["language"]
        segments_data = transcription_result["segments"]

        # Calculate word count
        word_count = sum(len(seg["text"].split()) for seg in segments_data)

        # Create transcript and segments in database
        async with async_session() as session:
            # Create transcript
            transcript = Transcript(
                recording_id=recording_id,
                language=detected_language,
                model_used=f"whisperx-{transcription_service.model_name}",
                word_count=word_count,
            )
            session.add(transcript)
            await session.flush()

            # Create segments
            for idx, seg in enumerate(segments_data):
                segment = Segment(
                    transcript_id=transcript.id,
                    segment_index=idx,
                    start_time=seg["start"],
                    end_time=seg["end"],
                    text=seg["text"],
                    confidence=seg.get("confidence"),
                )
                session.add(segment)

            # Update recording status to completed
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="completed")
            )
            await session.commit()

            transcript_id = transcript.id

        logger.info(
            "Transcription complete for recording %s: %d segments, %d words",
            recording_id,
            len(segments_data),
            word_count,
        )

        return {
            "transcript_id": transcript_id,
            "segment_count": len(segments_data),
            "word_count": word_count,
            "language": detected_language,
        }

    except Exception:
        # Update recording status to failed
        async with async_session() as session:
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="failed")
            )
            await session.commit()
        logger.exception("Transcription failed for recording %s", recording_id)
        raise


# Register the transcription handler
job_queue.register_handler("transcribe", handle_transcription)
