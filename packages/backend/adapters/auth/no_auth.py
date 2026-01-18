"""No-authentication provider for basic tier.

Provides a default admin user with full permissions without requiring login.
Used for single-user local installations.
"""

import uuid
from datetime import datetime

from core.interfaces import (
    AuthToken,
    IAuthProvider,
    LoginCredentials,
    Permission,
    RegistrationData,
    Role,
    User,
)


class NoAuthProvider(IAuthProvider):
    """No-authentication provider for basic tier.

    Always returns a default admin user with full permissions.
    All authentication operations are no-ops that succeed.
    """

    def __init__(self):
        """Initialize the no-auth provider."""
        self._default_user = User(
            id="default-user",
            username="local",
            email="local@localhost",
            role=Role.ADMIN,
            permissions=set(Permission),  # All permissions
            is_active=True,
            created_at=datetime.now(),
            metadata={"tier": "basic", "provider": "no_auth"},
        )

    async def authenticate(self, credentials: LoginCredentials) -> AuthToken:
        """Always succeeds with a dummy token."""
        return AuthToken(
            access_token="no-auth-token",
            token_type="bearer",
            expires_at=None,  # Never expires
        )

    async def validate_token(self, token: str) -> User:
        """Always returns the default user."""
        return self._default_user

    async def refresh_token(self, refresh_token: str) -> AuthToken:
        """Returns a new dummy token."""
        return AuthToken(
            access_token="no-auth-token-refreshed",
            token_type="bearer",
            expires_at=None,
        )

    async def logout(self, token: str) -> None:
        """No-op for basic tier."""
        pass

    async def get_current_user(self) -> User:
        """Returns the default admin user."""
        return self._default_user

    async def register(self, data: RegistrationData) -> User:
        """No-op for basic tier. Returns the default user."""
        # In basic tier, registration is not needed
        return self._default_user

    async def update_user(self, user_id: str, updates: dict) -> User:
        """No-op for basic tier. Returns the default user."""
        # Allow updating the default user's name for personalization
        if "username" in updates:
            self._default_user.username = updates["username"]
        if "email" in updates:
            self._default_user.email = updates["email"]
        return self._default_user

    async def delete_user(self, user_id: str) -> bool:
        """No-op for basic tier."""
        return False  # Cannot delete in basic tier

    async def list_users(
        self,
        page: int = 1,
        page_size: int = 20,
        role: Role | None = None,
    ) -> tuple[list[User], int]:
        """Returns only the default user."""
        return [self._default_user], 1

    async def change_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str,
    ) -> bool:
        """No-op for basic tier."""
        return True  # Always succeeds

    def requires_auth(self) -> bool:
        """Basic tier does not require authentication."""
        return False
