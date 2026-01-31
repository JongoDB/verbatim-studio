"""Add subtype column to storage_locations table."""

import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate(db_path: Path) -> None:
    """Add subtype column to storage_locations."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if storage_locations table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='storage_locations'"
        )
        if not cursor.fetchone():
            logger.info("storage_locations table does not exist yet - skipping migration")
            conn.close()
            return

        # Check if column already exists
        cursor.execute("PRAGMA table_info(storage_locations)")
        columns = [col[1] for col in cursor.fetchall()]

        if "subtype" not in columns:
            cursor.execute(
                "ALTER TABLE storage_locations ADD COLUMN subtype VARCHAR(50)"
            )
            conn.commit()
            logger.info("Added subtype column to storage_locations")
        else:
            logger.debug("subtype column already exists")

        # Refresh column list before checking for status
        cursor.execute("PRAGMA table_info(storage_locations)")
        columns = [col[1] for col in cursor.fetchall()]

        # Add status column for health tracking
        if "status" not in columns:
            cursor.execute(
                "ALTER TABLE storage_locations ADD COLUMN status VARCHAR(20) DEFAULT 'healthy'"
            )
            conn.commit()
            logger.info("Added status column to storage_locations")
        else:
            logger.debug("status column already exists")

        conn.close()
        logger.info("Storage subtype migration complete")

    except sqlite3.Error as e:
        logger.error(f"Database error during storage subtype migration: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during storage subtype migration: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    db_path = Path(__file__).parent.parent / "verbatim.db"
    migrate(db_path)
