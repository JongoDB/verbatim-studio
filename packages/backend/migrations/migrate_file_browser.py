"""Migration for file browser feature.

Adds:
- storage_locations table
- Recording: project_id, source_id, storage_location_id columns
- Document: source_id, storage_location_id columns
- Migrates data from project_recordings junction to Recording.project_id
- Creates default local storage location
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path

from sqlalchemy import text

logger = logging.getLogger(__name__)


async def migrate(db_path: str | None = None):
    """Run the migration."""
    from persistence.database import engine

    async with engine.begin() as conn:
        # 1. Create storage_locations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS storage_locations (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                config JSON DEFAULT '{}',
                is_default BOOLEAN DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created storage_locations table")

        # 2. Add columns to recordings (SQLite doesn't support IF NOT EXISTS for columns)
        # Check if columns exist first
        result = await conn.execute(text("PRAGMA table_info(recordings)"))
        columns = [row[1] for row in result.fetchall()]

        if "project_id" not in columns:
            await conn.execute(text(
                "ALTER TABLE recordings ADD COLUMN project_id VARCHAR(36) REFERENCES projects(id) ON DELETE SET NULL"
            ))
            logger.info("Added recordings.project_id column")

        if "source_id" not in columns:
            await conn.execute(text(
                "ALTER TABLE recordings ADD COLUMN source_id VARCHAR(36) REFERENCES recordings(id) ON DELETE SET NULL"
            ))
            logger.info("Added recordings.source_id column")

        if "storage_location_id" not in columns:
            await conn.execute(text(
                "ALTER TABLE recordings ADD COLUMN storage_location_id VARCHAR(36) REFERENCES storage_locations(id) ON DELETE SET NULL"
            ))
            logger.info("Added recordings.storage_location_id column")

        # 3. Add columns to documents
        result = await conn.execute(text("PRAGMA table_info(documents)"))
        columns = [row[1] for row in result.fetchall()]

        if "source_id" not in columns:
            await conn.execute(text(
                "ALTER TABLE documents ADD COLUMN source_id VARCHAR(36) REFERENCES documents(id) ON DELETE SET NULL"
            ))
            logger.info("Added documents.source_id column")

        if "storage_location_id" not in columns:
            await conn.execute(text(
                "ALTER TABLE documents ADD COLUMN storage_location_id VARCHAR(36) REFERENCES storage_locations(id) ON DELETE SET NULL"
            ))
            logger.info("Added documents.storage_location_id column")

        # 4. Migrate data from junction table to FK
        # For each recording, take the first project from junction (if any)
        await conn.execute(text("""
            UPDATE recordings
            SET project_id = (
                SELECT project_id FROM project_recordings
                WHERE project_recordings.recording_id = recordings.id
                LIMIT 1
            )
            WHERE project_id IS NULL
            AND EXISTS (
                SELECT 1 FROM project_recordings
                WHERE project_recordings.recording_id = recordings.id
            )
        """))
        logger.info("Migrated project_recordings data to Recording.project_id")

        # 5. Create default storage location if none exists
        result = await conn.execute(text("SELECT COUNT(*) FROM storage_locations WHERE is_default = 1"))
        count = result.scalar()

        if count == 0:
            from core.config import settings
            default_id = str(uuid.uuid4())
            config_json = json.dumps({"path": str(settings.MEDIA_DIR)})
            await conn.execute(text("""
                INSERT INTO storage_locations (id, name, type, config, is_default, is_active)
                VALUES (:id, 'Local Storage', 'local', :config, 1, 1)
            """), {"id": default_id, "config": config_json})
            logger.info("Created default local storage location")

    logger.info("Migration complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    asyncio.run(migrate())
