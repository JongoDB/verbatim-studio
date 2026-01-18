"""SQLite database adapter implementing IDatabaseAdapter.

This adapter provides the basic tier implementation using SQLite
with SQLAlchemy async driver (aiosqlite).
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.interfaces import (
    IDatabaseAdapter,
    IJobRepository,
    IProjectRepository,
    IRecordingRepository,
    ISegmentRepository,
    ISettingRepository,
    ISpeakerRepository,
    ITranscriptRepository,
)
from persistence.models import Base

from .repositories import (
    SQLiteJobRepository,
    SQLiteProjectRepository,
    SQLiteRecordingRepository,
    SQLiteSegmentRepository,
    SQLiteSettingRepository,
    SQLiteSpeakerRepository,
    SQLiteTranscriptRepository,
)


class SQLiteDatabaseAdapter(IDatabaseAdapter):
    """SQLite implementation of the database adapter.

    Manages database connection, session lifecycle, and provides
    access to all repositories.

    Usage:
        adapter = SQLiteDatabaseAdapter("sqlite+aiosqlite:///./app.db")
        await adapter.initialize()

        async with adapter.session() as session:
            project = await adapter.projects.get("123")

        await adapter.close()
    """

    def __init__(self, database_url: str, echo: bool = False):
        """Initialize the SQLite adapter.

        Args:
            database_url: SQLAlchemy database URL (sqlite+aiosqlite://...)
            echo: Enable SQL query logging
        """
        self._database_url = database_url
        self._echo = echo
        self._engine = None
        self._session_factory = None
        self._current_session: AsyncSession | None = None

        # Repository instances (lazily created per session)
        self._projects: IProjectRepository | None = None
        self._recordings: IRecordingRepository | None = None
        self._transcripts: ITranscriptRepository | None = None
        self._segments: ISegmentRepository | None = None
        self._speakers: ISpeakerRepository | None = None
        self._jobs: IJobRepository | None = None
        self._settings: ISettingRepository | None = None

    async def initialize(self) -> None:
        """Initialize the database connection and create tables."""
        self._engine = create_async_engine(
            self._database_url,
            echo=self._echo,
            future=True,
        )

        self._session_factory = async_sessionmaker(
            self._engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        # Create all tables
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def close(self) -> None:
        """Close database connections."""
        if self._engine:
            await self._engine.dispose()
            self._engine = None
            self._session_factory = None

    async def health_check(self) -> bool:
        """Check if database is accessible."""
        if not self._engine:
            return False
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """Context manager for database sessions.

        Provides a session with automatic commit/rollback handling.
        Repositories are automatically configured to use this session.

        Usage:
            async with adapter.session() as session:
                project = await adapter.projects.get("123")
        """
        if not self._session_factory:
            raise RuntimeError("Database not initialized. Call initialize() first.")

        async with self._session_factory() as session:
            self._current_session = session
            self._reset_repositories(session)
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                self._current_session = None
                self._clear_repositories()

    def _reset_repositories(self, session: AsyncSession) -> None:
        """Create new repository instances for the session."""
        self._projects = SQLiteProjectRepository(session)
        self._recordings = SQLiteRecordingRepository(session)
        self._transcripts = SQLiteTranscriptRepository(session)
        self._segments = SQLiteSegmentRepository(session)
        self._speakers = SQLiteSpeakerRepository(session)
        self._jobs = SQLiteJobRepository(session)
        self._settings = SQLiteSettingRepository(session)

    def _clear_repositories(self) -> None:
        """Clear repository instances."""
        self._projects = None
        self._recordings = None
        self._transcripts = None
        self._segments = None
        self._speakers = None
        self._jobs = None
        self._settings = None

    def _ensure_session(self) -> None:
        """Ensure a session is active."""
        if not self._current_session:
            raise RuntimeError("No active session. Use 'async with adapter.session():' context.")

    @property
    def projects(self) -> IProjectRepository:
        """Get the project repository."""
        self._ensure_session()
        assert self._projects is not None
        return self._projects

    @property
    def recordings(self) -> IRecordingRepository:
        """Get the recording repository."""
        self._ensure_session()
        assert self._recordings is not None
        return self._recordings

    @property
    def transcripts(self) -> ITranscriptRepository:
        """Get the transcript repository."""
        self._ensure_session()
        assert self._transcripts is not None
        return self._transcripts

    @property
    def segments(self) -> ISegmentRepository:
        """Get the segment repository."""
        self._ensure_session()
        assert self._segments is not None
        return self._segments

    @property
    def speakers(self) -> ISpeakerRepository:
        """Get the speaker repository."""
        self._ensure_session()
        assert self._speakers is not None
        return self._speakers

    @property
    def jobs(self) -> IJobRepository:
        """Get the job repository."""
        self._ensure_session()
        assert self._jobs is not None
        return self._jobs

    @property
    def settings(self) -> ISettingRepository:
        """Get the settings repository."""
        self._ensure_session()
        assert self._settings is not None
        return self._settings


async def get_database_adapter(database_url: str) -> SQLiteDatabaseAdapter:
    """Factory function to create and initialize a SQLite adapter.

    Args:
        database_url: SQLAlchemy database URL

    Returns:
        Initialized SQLiteDatabaseAdapter
    """
    adapter = SQLiteDatabaseAdapter(database_url)
    await adapter.initialize()
    return adapter
