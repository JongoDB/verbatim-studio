"""Add ai_summary column to transcripts table."""

import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate(db_path: Path) -> None:
    """Add ai_summary JSON column to transcripts."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if transcripts table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='transcripts'"
        )
        if not cursor.fetchone():
            logger.info("transcripts table does not exist yet - skipping migration")
            conn.close()
            return

        # Check if column already exists
        cursor.execute("PRAGMA table_info(transcripts)")
        columns = [col[1] for col in cursor.fetchall()]

        if "ai_summary" not in columns:
            cursor.execute(
                "ALTER TABLE transcripts ADD COLUMN ai_summary JSON DEFAULT NULL"
            )
            conn.commit()
            logger.info("Added ai_summary column to transcripts")
        else:
            logger.debug("ai_summary column already exists")

        conn.close()
        logger.info("Transcript ai_summary migration complete")

    except sqlite3.Error as e:
        logger.error(f"Database error during transcript ai_summary migration: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during transcript ai_summary migration: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    db_path = Path(__file__).parent.parent / "verbatim.db"
    migrate(db_path)
