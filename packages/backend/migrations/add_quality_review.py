"""Add quality review support: edited_by/original_text on segments + quality_review_records table."""

import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate(db_path: Path) -> None:
    """Add quality review columns and table."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if segments table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='segments'"
        )
        if not cursor.fetchone():
            logger.info("segments table does not exist yet - skipping migration")
            conn.close()
            return

        # Get existing columns on segments
        cursor.execute("PRAGMA table_info(segments)")
        columns = [col[1] for col in cursor.fetchall()]

        # Add edited_by column
        if "edited_by" not in columns:
            cursor.execute(
                "ALTER TABLE segments ADD COLUMN edited_by TEXT DEFAULT NULL"
            )
            # Migrate existing edited=True rows to edited_by='human'
            cursor.execute(
                "UPDATE segments SET edited_by = 'human' WHERE edited = 1"
            )
            logger.info("Added edited_by column and migrated existing edited flags")

        # Add original_text column
        if "original_text" not in columns:
            cursor.execute(
                "ALTER TABLE segments ADD COLUMN original_text TEXT DEFAULT NULL"
            )
            logger.info("Added original_text column to segments")

        # Create quality_review_records table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS quality_review_records (
                id TEXT PRIMARY KEY,
                transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
                job_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                context_hint TEXT,
                aggressiveness TEXT NOT NULL DEFAULT 'moderate',
                corrections_json JSON,
                stats_json JSON,
                applied_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        conn.close()
        logger.info("Quality review migration complete")

    except sqlite3.Error as e:
        logger.error(f"Database error during quality review migration: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during quality review migration: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    db_path = Path(__file__).parent.parent / "verbatim.db"
    migrate(db_path)
