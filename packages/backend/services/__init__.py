"""Services layer.

Note: ML-dependent services (transcription, diarization) are NOT imported here
to allow the backend to start without ML dependencies installed.
Import them directly when needed:
    from services.transcription import TranscriptionService, transcription_service
    from services.diarization import DiarizationService, diarization_service
"""

from .jobs import JobQueue, job_queue
from .storage import StorageService

__all__ = [
    "JobQueue",
    "job_queue",
    "StorageService",
]
