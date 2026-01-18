"""SQLite repository implementations."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.interfaces import (
    IJobRepository,
    IProjectRepository,
    IRecordingRepository,
    ISegmentRepository,
    ISettingRepository,
    ISpeakerRepository,
    ITranscriptRepository,
    JobEntity,
    PaginatedResult,
    ProjectEntity,
    RecordingEntity,
    SegmentEntity,
    SettingEntity,
    SpeakerEntity,
    TranscriptEntity,
)
from persistence.models import Job, Project, Recording, Segment, Setting, Speaker, Transcript

from .mappers import (
    entity_to_job,
    entity_to_project,
    entity_to_recording,
    entity_to_segment,
    entity_to_setting,
    entity_to_speaker,
    entity_to_transcript,
    job_to_entity,
    project_to_entity,
    recording_to_entity,
    segment_to_entity,
    setting_to_entity,
    speaker_to_entity,
    transcript_to_entity,
)


class SQLiteProjectRepository(IProjectRepository):
    """SQLite implementation of project repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: ProjectEntity) -> ProjectEntity:
        model = entity_to_project(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return project_to_entity(model)

    async def get(self, project_id: str) -> ProjectEntity | None:
        result = await self._session.get(Project, project_id)
        return project_to_entity(result) if result else None

    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
    ) -> PaginatedResult[ProjectEntity]:
        query = select(Project)

        if search:
            query = query.where(
                or_(
                    Project.name.ilike(f"%{search}%"),
                    Project.description.ilike(f"%{search}%"),
                )
            )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self._session.scalar(count_query) or 0

        # Apply pagination
        query = query.order_by(Project.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        items = [project_to_entity(p) for p in result.scalars().all()]

        return PaginatedResult(items=items, total=total, page=page, page_size=page_size)

    async def update(self, entity: ProjectEntity) -> ProjectEntity:
        model = await self._session.get(Project, entity.id)
        if not model:
            raise ValueError(f"Project {entity.id} not found")
        entity_to_project(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return project_to_entity(model)

    async def delete(self, project_id: str) -> bool:
        model = await self._session.get(Project, project_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True


class SQLiteRecordingRepository(IRecordingRepository):
    """SQLite implementation of recording repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: RecordingEntity) -> RecordingEntity:
        model = entity_to_recording(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return recording_to_entity(model)

    async def get(self, recording_id: str) -> RecordingEntity | None:
        result = await self._session.get(Recording, recording_id)
        return recording_to_entity(result) if result else None

    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        project_id: str | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> PaginatedResult[RecordingEntity]:
        query = select(Recording)

        if project_id:
            query = query.where(Recording.project_id == project_id)
        if status:
            query = query.where(Recording.status == status)
        if search:
            query = query.where(
                or_(
                    Recording.title.ilike(f"%{search}%"),
                    Recording.file_name.ilike(f"%{search}%"),
                )
            )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self._session.scalar(count_query) or 0

        # Apply pagination
        query = query.order_by(Recording.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        items = [recording_to_entity(r) for r in result.scalars().all()]

        return PaginatedResult(items=items, total=total, page=page, page_size=page_size)

    async def update(self, entity: RecordingEntity) -> RecordingEntity:
        model = await self._session.get(Recording, entity.id)
        if not model:
            raise ValueError(f"Recording {entity.id} not found")
        entity_to_recording(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return recording_to_entity(model)

    async def delete(self, recording_id: str) -> bool:
        model = await self._session.get(Recording, recording_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True


class SQLiteTranscriptRepository(ITranscriptRepository):
    """SQLite implementation of transcript repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: TranscriptEntity) -> TranscriptEntity:
        model = entity_to_transcript(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return transcript_to_entity(model)

    async def get(self, transcript_id: str) -> TranscriptEntity | None:
        result = await self._session.get(Transcript, transcript_id)
        return transcript_to_entity(result) if result else None

    async def get_by_recording(self, recording_id: str) -> TranscriptEntity | None:
        query = select(Transcript).where(Transcript.recording_id == recording_id)
        result = await self._session.execute(query)
        model = result.scalar_one_or_none()
        return transcript_to_entity(model) if model else None

    async def update(self, entity: TranscriptEntity) -> TranscriptEntity:
        model = await self._session.get(Transcript, entity.id)
        if not model:
            raise ValueError(f"Transcript {entity.id} not found")
        entity_to_transcript(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return transcript_to_entity(model)

    async def delete(self, transcript_id: str) -> bool:
        model = await self._session.get(Transcript, transcript_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True


class SQLiteSegmentRepository(ISegmentRepository):
    """SQLite implementation of segment repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: SegmentEntity) -> SegmentEntity:
        model = entity_to_segment(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return segment_to_entity(model)

    async def create_many(self, entities: list[SegmentEntity]) -> list[SegmentEntity]:
        models = [entity_to_segment(e) for e in entities]
        self._session.add_all(models)
        await self._session.flush()
        for model in models:
            await self._session.refresh(model)
        return [segment_to_entity(m) for m in models]

    async def get(self, segment_id: str) -> SegmentEntity | None:
        result = await self._session.get(Segment, segment_id)
        return segment_to_entity(result) if result else None

    async def list_by_transcript(
        self,
        transcript_id: str,
        page: int = 1,
        page_size: int = 100,
    ) -> PaginatedResult[SegmentEntity]:
        query = select(Segment).where(Segment.transcript_id == transcript_id)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self._session.scalar(count_query) or 0

        # Apply pagination and ordering
        query = query.order_by(Segment.segment_index)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        items = [segment_to_entity(s) for s in result.scalars().all()]

        return PaginatedResult(items=items, total=total, page=page, page_size=page_size)

    async def update(self, entity: SegmentEntity) -> SegmentEntity:
        model = await self._session.get(Segment, entity.id)
        if not model:
            raise ValueError(f"Segment {entity.id} not found")
        entity_to_segment(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return segment_to_entity(model)

    async def delete(self, segment_id: str) -> bool:
        model = await self._session.get(Segment, segment_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True

    async def search(
        self,
        query: str,
        transcript_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResult[SegmentEntity]:
        stmt = select(Segment).where(Segment.text.ilike(f"%{query}%"))

        if transcript_id:
            stmt = stmt.where(Segment.transcript_id == transcript_id)

        # Get total count
        count_query = select(func.count()).select_from(stmt.subquery())
        total = await self._session.scalar(count_query) or 0

        # Apply pagination and ordering
        stmt = stmt.order_by(Segment.start_time)
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(stmt)
        items = [segment_to_entity(s) for s in result.scalars().all()]

        return PaginatedResult(items=items, total=total, page=page, page_size=page_size)


class SQLiteSpeakerRepository(ISpeakerRepository):
    """SQLite implementation of speaker repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: SpeakerEntity) -> SpeakerEntity:
        model = entity_to_speaker(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return speaker_to_entity(model)

    async def create_many(self, entities: list[SpeakerEntity]) -> list[SpeakerEntity]:
        models = [entity_to_speaker(e) for e in entities]
        self._session.add_all(models)
        await self._session.flush()
        for model in models:
            await self._session.refresh(model)
        return [speaker_to_entity(m) for m in models]

    async def get(self, speaker_id: str) -> SpeakerEntity | None:
        result = await self._session.get(Speaker, speaker_id)
        return speaker_to_entity(result) if result else None

    async def list_by_transcript(self, transcript_id: str) -> list[SpeakerEntity]:
        query = select(Speaker).where(Speaker.transcript_id == transcript_id)
        result = await self._session.execute(query)
        return [speaker_to_entity(s) for s in result.scalars().all()]

    async def update(self, entity: SpeakerEntity) -> SpeakerEntity:
        model = await self._session.get(Speaker, entity.id)
        if not model:
            raise ValueError(f"Speaker {entity.id} not found")
        entity_to_speaker(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return speaker_to_entity(model)

    async def delete(self, speaker_id: str) -> bool:
        model = await self._session.get(Speaker, speaker_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True


class SQLiteJobRepository(IJobRepository):
    """SQLite implementation of job repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, entity: JobEntity) -> JobEntity:
        model = entity_to_job(entity)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return job_to_entity(model)

    async def get(self, job_id: str) -> JobEntity | None:
        result = await self._session.get(Job, job_id)
        return job_to_entity(result) if result else None

    async def list(
        self,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        job_type: str | None = None,
    ) -> PaginatedResult[JobEntity]:
        query = select(Job)

        if status:
            query = query.where(Job.status == status)
        if job_type:
            query = query.where(Job.job_type == job_type)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self._session.scalar(count_query) or 0

        # Apply pagination
        query = query.order_by(Job.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        items = [job_to_entity(j) for j in result.scalars().all()]

        return PaginatedResult(items=items, total=total, page=page, page_size=page_size)

    async def get_next_pending(self, job_type: str | None = None) -> JobEntity | None:
        query = select(Job).where(Job.status == "queued")

        if job_type:
            query = query.where(Job.job_type == job_type)

        query = query.order_by(Job.created_at.asc()).limit(1)

        result = await self._session.execute(query)
        model = result.scalar_one_or_none()
        return job_to_entity(model) if model else None

    async def update(self, entity: JobEntity) -> JobEntity:
        model = await self._session.get(Job, entity.id)
        if not model:
            raise ValueError(f"Job {entity.id} not found")
        entity_to_job(entity, model)
        await self._session.flush()
        await self._session.refresh(model)
        return job_to_entity(model)

    async def delete(self, job_id: str) -> bool:
        model = await self._session.get(Job, job_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True


class SQLiteSettingRepository(ISettingRepository):
    """SQLite implementation of setting repository."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def get(self, key: str) -> SettingEntity | None:
        result = await self._session.get(Setting, key)
        return setting_to_entity(result) if result else None

    async def set(self, entity: SettingEntity) -> SettingEntity:
        model = await self._session.get(Setting, entity.key)
        if model:
            entity_to_setting(entity, model)
        else:
            model = entity_to_setting(entity)
            self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return setting_to_entity(model)

    async def delete(self, key: str) -> bool:
        model = await self._session.get(Setting, key)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True

    async def list_all(self) -> list[SettingEntity]:
        query = select(Setting)
        result = await self._session.execute(query)
        return [setting_to_entity(s) for s in result.scalars().all()]
