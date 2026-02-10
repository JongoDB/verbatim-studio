"""Add indexes on segments table for common query patterns."""

import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate(db_path: Path) -> None:
    """Add indexes on segments.transcript_id and segments.speaker."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if segments table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='segments'"
        )
        if not cursor.fetchone():
            logger.info("segments table does not exist, skipping migration")
            conn.close()
            return

        # Add index on transcript_id (most common lookup)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_segments_transcript_id ON segments(transcript_id)"
        )

        # Add index on speaker (used in filtering)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_segments_speaker ON segments(speaker)"
        )

        conn.commit()
        conn.close()
        logger.info("Successfully added segment indexes")
    except sqlite3.Error as e:
        logger.error(f"Failed to add segment indexes: {e}")
