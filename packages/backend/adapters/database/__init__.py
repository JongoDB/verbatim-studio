"""Database adapter implementations.

Basic tier: SQLite adapter
Enterprise tier: PostgreSQL adapter (future)
"""

from .sqlite import SQLiteDatabaseAdapter

__all__ = ["SQLiteDatabaseAdapter"]
