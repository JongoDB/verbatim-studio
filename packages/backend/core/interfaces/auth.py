"""Authentication provider interface definitions.

This module defines the contract for authentication operations,
allowing different implementations (NoAuth for basic, full RBAC for enterprise)
to be swapped transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class Role(str, Enum):
    """User roles for RBAC."""

    ADMIN = "admin"
    USER = "user"
    VIEWER = "viewer"


class Permission(str, Enum):
    """Granular permissions."""

    # Recording permissions
    RECORDING_CREATE = "recording:create"
    RECORDING_READ = "recording:read"
    RECORDING_UPDATE = "recording:update"
    RECORDING_DELETE = "recording:delete"

    # Transcript permissions
    TRANSCRIPT_READ = "transcript:read"
    TRANSCRIPT_UPDATE = "transcript:update"

    # Project permissions
    PROJECT_CREATE = "project:create"
    PROJECT_READ = "project:read"
    PROJECT_UPDATE = "project:update"
    PROJECT_DELETE = "project:delete"

    # Admin permissions
    USER_MANAGE = "user:manage"
    SETTINGS_MANAGE = "settings:manage"
    SYSTEM_ADMIN = "system:admin"


# Default role-permission mappings
ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.ADMIN: set(Permission),  # All permissions
    Role.USER: {
        Permission.RECORDING_CREATE,
        Permission.RECORDING_READ,
        Permission.RECORDING_UPDATE,
        Permission.RECORDING_DELETE,
        Permission.TRANSCRIPT_READ,
        Permission.TRANSCRIPT_UPDATE,
        Permission.PROJECT_CREATE,
        Permission.PROJECT_READ,
        Permission.PROJECT_UPDATE,
        Permission.PROJECT_DELETE,
    },
    Role.VIEWER: {
        Permission.RECORDING_READ,
        Permission.TRANSCRIPT_READ,
        Permission.PROJECT_READ,
    },
}


@dataclass
class User:
    """Authenticated user entity."""

    id: str
    username: str
    email: str | None = None
    role: Role = Role.USER
    permissions: set[Permission] = field(default_factory=set)
    is_active: bool = True
    created_at: datetime | None = None
    last_login: datetime | None = None
    metadata: dict = field(default_factory=dict)

    def has_permission(self, permission: Permission) -> bool:
        """Check if user has a specific permission."""
        # Check explicit permissions first
        if permission in self.permissions:
            return True
        # Fall back to role-based permissions
        return permission in ROLE_PERMISSIONS.get(self.role, set())

    def has_any_permission(self, *permissions: Permission) -> bool:
        """Check if user has any of the specified permissions."""
        return any(self.has_permission(p) for p in permissions)

    def has_all_permissions(self, *permissions: Permission) -> bool:
        """Check if user has all of the specified permissions."""
        return all(self.has_permission(p) for p in permissions)


@dataclass
class AuthToken:
    """Authentication token."""

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime | None = None
    refresh_token: str | None = None


@dataclass
class LoginCredentials:
    """Login credentials."""

    username: str
    password: str


@dataclass
class RegistrationData:
    """User registration data."""

    username: str
    email: str
    password: str
    role: Role = Role.USER


class IAuthProvider(ABC):
    """Interface for authentication operations.

    Implementations:
    - NoAuthProvider: Basic tier, returns a default user with full access
    - LocalAuthProvider: Enterprise tier, local user database with RBAC
    - OIDCAuthProvider: Enterprise tier, OpenID Connect integration
    """

    @abstractmethod
    async def authenticate(self, credentials: LoginCredentials) -> AuthToken:
        """Authenticate a user and return a token.

        Args:
            credentials: Login credentials

        Returns:
            AuthToken on success

        Raises:
            AuthenticationError on failure
        """
        ...

    @abstractmethod
    async def validate_token(self, token: str) -> User:
        """Validate a token and return the associated user.

        Args:
            token: The access token to validate

        Returns:
            User associated with the token

        Raises:
            AuthenticationError if token is invalid or expired
        """
        ...

    @abstractmethod
    async def refresh_token(self, refresh_token: str) -> AuthToken:
        """Refresh an access token.

        Args:
            refresh_token: The refresh token

        Returns:
            New AuthToken

        Raises:
            AuthenticationError if refresh token is invalid
        """
        ...

    @abstractmethod
    async def logout(self, token: str) -> None:
        """Invalidate a token (logout).

        Args:
            token: The token to invalidate
        """
        ...

    @abstractmethod
    async def get_current_user(self) -> User:
        """Get the current authenticated user.

        For NoAuthProvider, returns a default admin user.
        For other providers, returns the user from the current request context.

        Returns:
            Current User
        """
        ...

    @abstractmethod
    async def register(self, data: RegistrationData) -> User:
        """Register a new user.

        Args:
            data: Registration data

        Returns:
            Created User

        Raises:
            RegistrationError if username/email already exists
        """
        ...

    @abstractmethod
    async def update_user(self, user_id: str, updates: dict) -> User:
        """Update user information.

        Args:
            user_id: User ID to update
            updates: Dict of fields to update

        Returns:
            Updated User
        """
        ...

    @abstractmethod
    async def delete_user(self, user_id: str) -> bool:
        """Delete a user.

        Args:
            user_id: User ID to delete

        Returns:
            True if deleted
        """
        ...

    @abstractmethod
    async def list_users(
        self,
        page: int = 1,
        page_size: int = 20,
        role: Role | None = None,
    ) -> tuple[list[User], int]:
        """List users with pagination.

        Args:
            page: Page number (1-indexed)
            page_size: Items per page
            role: Filter by role

        Returns:
            Tuple of (users list, total count)
        """
        ...

    @abstractmethod
    async def change_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str,
    ) -> bool:
        """Change a user's password.

        Args:
            user_id: User ID
            current_password: Current password for verification
            new_password: New password

        Returns:
            True if password changed successfully

        Raises:
            AuthenticationError if current password is wrong
        """
        ...

    @abstractmethod
    def requires_auth(self) -> bool:
        """Check if this provider requires authentication.

        Returns:
            True for enterprise providers, False for NoAuthProvider
        """
        ...
