"""Job queue service for async task processing."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select, update

from persistence.database import async_session
from persistence.models import Job, Recording, Segment, SegmentEmbedding, Speaker, Transcript

logger = logging.getLogger(__name__)


class JobCancelled(Exception):
    """Raised when a job is cancelled via cooperative cancellation."""


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
        self._cancelled_jobs: set[str] = set()
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

            # Create progress callback with cancellation check
            async def update_progress(progress: float) -> None:
                """Update job progress in database. Raises JobCancelled if requested."""
                if job_id in self._cancelled_jobs:
                    raise JobCancelled(f"Job {job_id} was cancelled")
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

        except JobCancelled:
            logger.info("Job %s cancelled by user", job_id)
            async with async_session() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="cancelled",
                        error="Cancelled by user",
                        completed_at=datetime.now(UTC),
                    )
                )
                await session.commit()

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
            # Clean up future reference and cancellation tracking
            self._futures.pop(job_id, None)
            self._cancelled_jobs.discard(job_id)

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
        """Cancel a queued or running job.

        Queued jobs are cancelled immediately. Running jobs are cancelled
        cooperatively — the next progress callback will raise JobCancelled.

        Args:
            job_id: The job ID to cancel.

        Returns:
            True if job was cancelled (or cancellation requested), False if not found or not cancellable.
        """
        async with async_session() as session:
            result = await session.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one_or_none()

            if job is None:
                return False

            if job.status == "queued":
                # Immediate cancellation for queued jobs
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(status="cancelled", completed_at=datetime.now(UTC))
                )
                await session.commit()

                future = self._futures.pop(job_id, None)
                if future is not None:
                    future.cancel()

                logger.info("Job %s cancelled (was queued)", job_id)
                return True

            if job.status == "running":
                # Cooperative cancellation for running jobs
                self._cancelled_jobs.add(job_id)
                logger.info("Job %s cancellation requested (running)", job_id)
                return True

            return False

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
    """Handle transcription job with optional diarization.

    Args:
        payload: Job payload with:
            - recording_id: Required recording ID
            - language: Optional language code
            - diarize: Optional bool to enable diarization (default True)
        progress_callback: Callback to report progress.

    Returns:
        Result dictionary with transcript_id, segment count, speaker count.

    Raises:
        ValueError: If recording not found or invalid.
    """
    from core.factory import create_transcription_engine_from_settings
    from core.interfaces import TranscriptionOptions, TranscriptionProgress, TranscriptionResult
    from core.transcription_settings import detect_diarization_device, get_transcription_settings
    from services.diarization import DiarizationService

    recording_id = payload.get("recording_id")
    language = payload.get("language")
    diarize_requested = payload.get("diarize", True)  # Default to enabled

    # Read effective settings fresh for this job
    effective = await get_transcription_settings()
    dia_device = detect_diarization_device()
    logger.info(
        "Effective transcription settings: engine=%s, model=%s, device=%s, compute_type=%s, batch_size=%s, diarize=%s, dia_device=%s",
        effective.get("engine", "auto"),
        effective["model"],
        effective["device"],
        effective["compute_type"],
        effective["batch_size"],
        effective["diarize"],
        dia_device,
    )

    # Create transcription engine based on settings
    tx_engine = create_transcription_engine_from_settings(effective)

    # Check if engine supports diarization
    engine_info = await tx_engine.get_engine_info()
    supports_diarization = engine_info.get("supports_diarization", True)
    if not supports_diarization:
        logger.info(
            "Skipping diarization - not supported by %s",
            engine_info.get("name", "unknown engine"),
        )

    # Create diarization service
    dia_service = DiarizationService(
        device=dia_device,
        hf_token=effective.get("hf_token"),
    )

    # Determine if we should run diarization
    diarize = diarize_requested and effective["diarize"] and supports_diarization

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

        # Use extracted audio for video files, otherwise use original
        audio_path = recording.file_path
        extracted_audio = Path(recording.file_path).parent / "audio.wav"
        if extracted_audio.exists():
            audio_path = str(extracted_audio)

    try:
        # Run transcription with streaming progress
        options = TranscriptionOptions(
            language=language,
            model_size=effective["model"],
            compute_type=effective["compute_type"],
            batch_size=effective["batch_size"],
        )

        transcription_result: TranscriptionResult | None = None
        async for item in tx_engine.transcribe_stream(audio_path, options):
            if isinstance(item, TranscriptionProgress):
                # Map engine progress (0-1) to job progress (0-60%)
                await progress_callback(item.progress * 60)
            elif isinstance(item, TranscriptionResult):
                transcription_result = item

        if transcription_result is None:
            raise ValueError("Transcription did not produce a result")

        detected_language = transcription_result.language
        # Convert segments to dict format for diarization service
        segments_data = [
            {
                "start": seg.start,
                "end": seg.end,
                "text": seg.text,
                "confidence": seg.confidence,
                "words": [
                    {"word": w.word, "start": w.start, "end": w.end, "score": w.confidence}
                    for w in seg.words
                ] if seg.words else [],
            }
            for seg in transcription_result.segments
        ]
        speakers_found: list[str] = []

        # Run diarization if enabled
        if diarize and segments_data:
            # Wrap progress for diarization phase (60-95%)
            async def diarization_progress(p: float) -> None:
                await progress_callback(60 + p * 0.35)

            try:
                logger.info("Starting diarization for %s with %d segments", audio_path, len(segments_data))
                diarization_result = await dia_service.diarize(
                    audio_path=audio_path,
                    segments=segments_data,
                    progress_callback=diarization_progress,
                )
                segments_data = diarization_result["segments"]
                speakers_found = diarization_result["speakers"]
                logger.info("Diarization found %d speakers", len(speakers_found))
            except Exception as e:
                # Log but don't fail - diarization is optional
                logger.warning("Diarization failed, continuing without speakers: %s", e, exc_info=True)

        await progress_callback(95)

        # Calculate word count
        word_count = sum(len(seg.get("text", "").split()) for seg in segments_data)

        # Create transcript, segments, and speakers in database
        async with async_session() as session:
            # Delete existing transcript if re-transcribing (CASCADE deletes segments, speakers, etc.)
            existing = await session.execute(
                select(Transcript).where(Transcript.recording_id == recording_id)
            )
            existing_transcript = existing.scalar_one_or_none()
            if existing_transcript:
                await session.delete(existing_transcript)
                await session.flush()

            # Create transcript
            transcript = Transcript(
                recording_id=recording_id,
                language=detected_language,
                model_used=transcription_result.model_used or f"{engine_info.get('name', 'unknown')}-{effective['model']}",
                word_count=word_count,
            )
            session.add(transcript)
            await session.flush()

            # Create segments with speaker labels
            for idx, seg in enumerate(segments_data):
                segment = Segment(
                    transcript_id=transcript.id,
                    segment_index=idx,
                    speaker=seg.get("speaker"),  # Now includes speaker from diarization
                    start_time=seg.get("start", 0.0),
                    end_time=seg.get("end", 0.0),
                    text=seg.get("text", ""),
                    confidence=seg.get("confidence") or seg.get("score"),
                )
                session.add(segment)

            # Create speaker entries for renaming
            for speaker_label in speakers_found:
                speaker = Speaker(
                    transcript_id=transcript.id,
                    speaker_label=speaker_label,
                )
                session.add(speaker)

            # Update recording status to completed
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="completed")
            )
            await session.commit()

            transcript_id = transcript.id

        # Auto-queue embedding job if service is available
        from services.embedding import embedding_service
        if embedding_service.is_available():
            try:
                await job_queue.enqueue("embed", {"transcript_id": transcript_id})
                logger.info("Queued embedding job for transcript %s", transcript_id)
            except Exception as e:
                logger.warning("Failed to queue embedding job: %s", e)

        await progress_callback(100)

        logger.info(
            "Transcription complete for recording %s: %d segments, %d words, %d speakers",
            recording_id,
            len(segments_data),
            word_count,
            len(speakers_found),
        )

        return {
            "transcript_id": transcript_id,
            "segment_count": len(segments_data),
            "word_count": word_count,
            "language": detected_language,
            "speaker_count": len(speakers_found),
        }

    except JobCancelled:
        # Update recording status to cancelled
        async with async_session() as session:
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="cancelled")
            )
            await session.commit()
        logger.info("Transcription cancelled for recording %s", recording_id)
        raise

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


async def handle_embedding(
    payload: dict[str, Any], progress_callback: ProgressCallback
) -> dict[str, Any]:
    """Generate embeddings for all segments in a transcript.

    Args:
        payload: Job payload with:
            - transcript_id: Required transcript ID
        progress_callback: Callback to report progress.

    Returns:
        Result dictionary with segment_count.

    Raises:
        ValueError: If transcript not found.
    """
    import asyncio
    from sqlalchemy.exc import OperationalError
    from services.embedding import embedding_service, embedding_to_bytes

    transcript_id = payload.get("transcript_id")
    if not transcript_id:
        raise ValueError("Missing transcript_id in payload")

    # Check if embeddings are available
    if not embedding_service.is_available():
        logger.warning("Embedding service not available, skipping embed job")
        return {"segment_count": 0, "skipped": True}

    # Small delay to avoid SQLite lock contention with transcription commit
    await asyncio.sleep(2)

    # Load segments for this transcript
    async with async_session() as session:
        result = await session.execute(
            select(Segment)
            .where(Segment.transcript_id == transcript_id)
            .order_by(Segment.segment_index)
        )
        segments = result.scalars().all()

        if not segments:
            logger.warning("No segments found for transcript %s", transcript_id)
            return {"segment_count": 0}

        logger.info("Generating embeddings for %d segments", len(segments))

        # Extract texts
        texts = [seg.text for seg in segments]
        segment_ids = [seg.id for seg in segments]

    # Generate embeddings in batch
    await progress_callback(10)
    embeddings = await embedding_service.embed_texts(texts)
    await progress_callback(80)

    # Store embeddings with retry for database lock
    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with async_session() as session:
                for i, (seg_id, emb) in enumerate(zip(segment_ids, embeddings)):
                    # Check if embedding already exists (upsert)
                    existing = await session.get(SegmentEmbedding, seg_id)
                    if existing:
                        existing.embedding = embedding_to_bytes(emb)
                        existing.model_used = embedding_service._model_name
                    else:
                        segment_embedding = SegmentEmbedding(
                            segment_id=seg_id,
                            embedding=embedding_to_bytes(emb),
                            model_used=embedding_service._model_name,
                        )
                        session.add(segment_embedding)

                    # Progress update every 10 segments
                    if i % 10 == 0:
                        await progress_callback(80 + (i / len(embeddings)) * 20)

                await session.commit()
                break  # Success, exit retry loop
        except OperationalError as e:
            if "database is locked" in str(e) and attempt < max_retries - 1:
                logger.warning("Database locked, retrying in %d seconds (attempt %d/%d)",
                             2 ** attempt, attempt + 1, max_retries)
                await asyncio.sleep(2 ** attempt)  # Exponential backoff: 1, 2, 4 seconds
            else:
                raise

    await progress_callback(100)

    logger.info(
        "Embeddings complete for transcript %s: %d segments",
        transcript_id,
        len(segments),
    )

    return {"segment_count": len(segments), "transcript_id": transcript_id}


# Register the embedding handler
job_queue.register_handler("embed", handle_embedding)
