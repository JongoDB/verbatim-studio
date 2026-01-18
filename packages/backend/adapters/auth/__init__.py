"""Authentication provider adapter implementations.

Basic tier: NoAuthProvider (single-user, no login required)
Enterprise tier: LocalAuthProvider, OIDCAuthProvider (future)
"""

from .no_auth import NoAuthProvider

__all__ = ["NoAuthProvider"]
