"""Database connection and session management."""

from collections.abc import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"timeout": 30},  # Wait up to 30s for database locks
)


# Enable WAL mode for better concurrency (allows concurrent reads during writes)
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")  # Enable foreign key constraints (required for CASCADE)
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes, still safe with WAL
    cursor.execute("PRAGMA busy_timeout=30000")  # 30s timeout at SQLite level
    cursor.close()

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for database sessions."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            raise


async def seed_defaults(session: AsyncSession) -> None:
    """Seed or update default project types and recording templates."""
    from sqlalchemy import select

    from .defaults import DEFAULT_PROJECT_TYPES, DEFAULT_RECORDING_TEMPLATES
    from .models import ProjectType, RecordingTemplate

    # Seed/update project types
    for pt_data in DEFAULT_PROJECT_TYPES:
        result = await session.execute(
            select(ProjectType).where(ProjectType.name == pt_data["name"])
        )
        existing = result.scalar_one_or_none()
        if existing:
            # Update existing system defaults with latest schema
            if existing.is_system:
                existing.description = pt_data["description"]
                existing.metadata_schema = pt_data["metadata_schema"]
        else:
            pt = ProjectType(
                name=pt_data["name"],
                description=pt_data["description"],
                metadata_schema=pt_data["metadata_schema"],
                is_system=True,
            )
            session.add(pt)

    # Seed/update recording templates
    for rt_data in DEFAULT_RECORDING_TEMPLATES:
        result = await session.execute(
            select(RecordingTemplate).where(RecordingTemplate.name == rt_data["name"])
        )
        existing = result.scalar_one_or_none()
        if existing:
            # Update existing system defaults with latest schema
            if existing.is_system:
                existing.description = rt_data["description"]
                existing.metadata_schema = rt_data["metadata_schema"]
        else:
            rt = RecordingTemplate(
                name=rt_data["name"],
                description=rt_data["description"],
                metadata_schema=rt_data["metadata_schema"],
                is_system=True,
            )
            session.add(rt)

    await session.commit()


async def init_db() -> None:
    """Initialize database tables and seed defaults."""
    from .models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Run schema migrations for changes that create_all won't handle
    async with engine.begin() as conn:
        await _run_migrations(conn)

    # Auto-seed defaults on startup
    async with async_session() as session:
        await seed_defaults(session)


async def _run_migrations(conn) -> None:
    """Run schema migrations that create_all doesn't handle (column drops, renames, etc)."""
    # Note: Recording.project_id FK is now the standard pattern (single project per recording).
    # The project_recordings junction table is kept for backward compatibility during migration.

    # Run file browser migration (adds storage_locations table and FK columns)
    from migrations.migrate_file_browser import migrate as migrate_file_browser
    await migrate_file_browser()

    # Run storage subtype migration (adds subtype and status columns)
    # This is synchronous sqlite3, run it via run_sync
    from pathlib import Path
    from migrations.add_storage_subtype import migrate as migrate_storage_subtype
    db_path = Path(__file__).parent.parent / "verbatim.db"
    await conn.run_sync(lambda _: migrate_storage_subtype(db_path))
