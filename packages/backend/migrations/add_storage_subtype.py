"""Add subtype column to storage_locations table."""

import sqlite3
from pathlib import Path


def migrate(db_path: Path) -> None:
    """Add subtype column to storage_locations."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check if storage_locations table exists
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='storage_locations'"
    )
    if not cursor.fetchone():
        print("storage_locations table does not exist yet - skipping migration")
        print("(The table will be created with new columns when the app starts)")
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
        print("Added subtype column to storage_locations")
    else:
        print("subtype column already exists")

    # Add status column for health tracking
    if "status" not in columns:
        cursor.execute(
            "ALTER TABLE storage_locations ADD COLUMN status VARCHAR(20) DEFAULT 'healthy'"
        )
        conn.commit()
        print("Added status column to storage_locations")
    else:
        print("status column already exists")

    conn.close()


if __name__ == "__main__":
    db_path = Path(__file__).parent.parent / "verbatim.db"
    migrate(db_path)
