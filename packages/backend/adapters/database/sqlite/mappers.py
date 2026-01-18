"""Entity mappers between SQLAlchemy models and domain entities."""

from core.interfaces import (
    JobEntity,
    ProjectEntity,
    RecordingEntity,
    SegmentEntity,
    SettingEntity,
    SpeakerEntity,
    TranscriptEntity,
)
from persistence.models import Job, Project, Recording, Segment, Setting, Speaker, Transcript


def project_to_entity(model: Project) -> ProjectEntity:
    """Convert Project model to ProjectEntity."""
    return ProjectEntity(
        id=model.id,
        name=model.name,
        description=model.description,
        metadata=model.metadata_ or {},
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def entity_to_project(entity: ProjectEntity, model: Project | None = None) -> Project:
    """Convert ProjectEntity to Project model."""
    if model is None:
        model = Project()
    model.id = entity.id
    model.name = entity.name
    model.description = entity.description
    model.metadata_ = entity.metadata or {}
    return model


def recording_to_entity(model: Recording) -> RecordingEntity:
    """Convert Recording model to RecordingEntity."""
    return RecordingEntity(
        id=model.id,
        title=model.title,
        file_path=model.file_path,
        file_name=model.file_name,
        project_id=model.project_id,
        file_size=model.file_size,
        duration_seconds=model.duration_seconds,
        mime_type=model.mime_type,
        metadata=model.metadata_ or {},
        status=model.status,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def entity_to_recording(entity: RecordingEntity, model: Recording | None = None) -> Recording:
    """Convert RecordingEntity to Recording model."""
    if model is None:
        model = Recording()
    model.id = entity.id
    model.title = entity.title
    model.file_path = entity.file_path
    model.file_name = entity.file_name
    model.project_id = entity.project_id
    model.file_size = entity.file_size
    model.duration_seconds = entity.duration_seconds
    model.mime_type = entity.mime_type
    model.metadata_ = entity.metadata or {}
    model.status = entity.status
    return model


def transcript_to_entity(model: Transcript) -> TranscriptEntity:
    """Convert Transcript model to TranscriptEntity."""
    return TranscriptEntity(
        id=model.id,
        recording_id=model.recording_id,
        language=model.language,
        model_used=model.model_used,
        confidence_avg=model.confidence_avg,
        word_count=model.word_count,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def entity_to_transcript(entity: TranscriptEntity, model: Transcript | None = None) -> Transcript:
    """Convert TranscriptEntity to Transcript model."""
    if model is None:
        model = Transcript()
    model.id = entity.id
    model.recording_id = entity.recording_id
    model.language = entity.language
    model.model_used = entity.model_used
    model.confidence_avg = entity.confidence_avg
    model.word_count = entity.word_count
    return model


def segment_to_entity(model: Segment) -> SegmentEntity:
    """Convert Segment model to SegmentEntity."""
    return SegmentEntity(
        id=model.id,
        transcript_id=model.transcript_id,
        segment_index=model.segment_index,
        start_time=model.start_time,
        end_time=model.end_time,
        text=model.text,
        speaker=model.speaker,
        confidence=model.confidence,
        edited=model.edited,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def entity_to_segment(entity: SegmentEntity, model: Segment | None = None) -> Segment:
    """Convert SegmentEntity to Segment model."""
    if model is None:
        model = Segment()
    model.id = entity.id
    model.transcript_id = entity.transcript_id
    model.segment_index = entity.segment_index
    model.start_time = entity.start_time
    model.end_time = entity.end_time
    model.text = entity.text
    model.speaker = entity.speaker
    model.confidence = entity.confidence
    model.edited = entity.edited
    return model


def speaker_to_entity(model: Speaker) -> SpeakerEntity:
    """Convert Speaker model to SpeakerEntity."""
    return SpeakerEntity(
        id=model.id,
        transcript_id=model.transcript_id,
        speaker_label=model.speaker_label,
        speaker_name=model.speaker_name,
        color=model.color,
    )


def entity_to_speaker(entity: SpeakerEntity, model: Speaker | None = None) -> Speaker:
    """Convert SpeakerEntity to Speaker model."""
    if model is None:
        model = Speaker()
    model.id = entity.id
    model.transcript_id = entity.transcript_id
    model.speaker_label = entity.speaker_label
    model.speaker_name = entity.speaker_name
    model.color = entity.color
    return model


def job_to_entity(model: Job) -> JobEntity:
    """Convert Job model to JobEntity."""
    return JobEntity(
        id=model.id,
        job_type=model.job_type,
        payload=model.payload,
        status=model.status,
        result=model.result,
        error=model.error,
        progress=model.progress,
        created_at=model.created_at,
        started_at=model.started_at,
        completed_at=model.completed_at,
    )


def entity_to_job(entity: JobEntity, model: Job | None = None) -> Job:
    """Convert JobEntity to Job model."""
    if model is None:
        model = Job()
    model.id = entity.id
    model.job_type = entity.job_type
    model.payload = entity.payload
    model.status = entity.status
    model.result = entity.result
    model.error = entity.error
    model.progress = entity.progress
    model.started_at = entity.started_at
    model.completed_at = entity.completed_at
    return model


def setting_to_entity(model: Setting) -> SettingEntity:
    """Convert Setting model to SettingEntity."""
    return SettingEntity(
        key=model.key,
        value=model.value,
        updated_at=model.updated_at,
    )


def entity_to_setting(entity: SettingEntity, model: Setting | None = None) -> Setting:
    """Convert SettingEntity to Setting model."""
    if model is None:
        model = Setting()
    model.key = entity.key
    model.value = entity.value
    return model
