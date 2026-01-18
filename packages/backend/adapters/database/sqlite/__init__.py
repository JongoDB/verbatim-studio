"""SQLite database adapter for basic tier.

Uses SQLAlchemy with async SQLite driver (aiosqlite).
"""

from .adapter import SQLiteDatabaseAdapter

__all__ = ["SQLiteDatabaseAdapter"]
