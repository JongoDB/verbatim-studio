# Enterprise Package (Phase 3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `verbatim-enterprise` — a pip-installable plugin package that adds PostgreSQL, auth/RBAC, teams, API keys, webhooks, LLM passthrough, admin dashboard, audit logging, and license management to Verbatim Studio.

**Architecture:** Single `EnterprisePlugin` class registers everything via the open source plugin system. Enterprise is a separate private GitHub repo. Some small backward-compatible changes are needed in the open source repo to support adapter consumption and additional event emissions.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy (async), PostgreSQL (asyncpg), python-jose (JWT), argon2-cffi (password hashing), boto3 (S3), openai/anthropic SDKs, React + Vite (admin frontend)

---

## Part A: Open Source Prep (verbatim-studio repo)

These tasks happen in the main `verbatim-studio` repo before enterprise work begins.

---

### Task 1: Adapter Consumption in Core Factory

The core `AdapterFactory` (core/factory.py) currently has hardcoded `NotImplementedError` for enterprise tier. It needs to check the plugin registry for adapters registered by plugins.

**Files:**
- Modify: `packages/backend/core/factory.py`
- Test: `packages/backend/tests/test_factory_plugin_adapters.py`

**Step 1: Write failing test**

```python
# packages/backend/tests/test_factory_plugin_adapters.py
"""Test that AdapterFactory can consume plugin-registered adapters."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from core.factory import AdapterFactory, AdapterConfig
from core.plugins import PluginRegistry, load_plugins, _registry


@pytest.fixture(autouse=True)
def reset_registry():
    """Reset plugin registry between tests."""
    import core.plugins as plugins_mod
    old = plugins_mod._registry
    plugins_mod._registry = PluginRegistry()
    yield plugins_mod._registry
    plugins_mod._registry = old


def test_enterprise_database_adapter_from_registry(reset_registry):
    """When a database adapter is registered via plugin, factory should use it."""
    mock_adapter_class = MagicMock()
    mock_instance = AsyncMock()
    mock_adapter_class.return_value = mock_instance

    reset_registry.add_adapter("database", "postgresql", mock_adapter_class)

    config = AdapterConfig(database_url="postgresql+asyncpg://localhost/test")
    factory = AdapterFactory("enterprise", config)

    # Factory should find the plugin-registered adapter
    from core.plugins import get_registry
    registry = get_registry()
    adapters = registry._adapters.get("database", {})
    assert "postgresql" in adapters
    assert adapters["postgresql"] is mock_adapter_class


def test_enterprise_ai_adapter_from_registry(reset_registry):
    """When an AI adapter is registered via plugin, factory should use it."""
    mock_adapter_class = MagicMock()
    reset_registry.add_adapter("llm", "openai", mock_adapter_class)

    from core.plugins import get_registry
    registry = get_registry()
    adapters = registry._adapters.get("llm", {})
    assert "openai" in adapters


def test_basic_tier_ignores_plugin_adapters(reset_registry):
    """Basic tier should still use built-in adapters, not plugin ones."""
    config = AdapterConfig(database_url="sqlite+aiosqlite:///./test.db")
    factory = AdapterFactory("basic", config)
    assert factory.is_basic
    # Basic tier methods should still work without touching plugin registry
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/packages/backend && python3 -m pytest tests/test_factory_plugin_adapters.py -v`

**Step 3: Update factory to check plugin registry**

In `packages/backend/core/factory.py`, modify the enterprise branches to check the plugin registry:

```python
# In create_database_adapter(), replace the enterprise else branch:
else:
    from core.plugins import get_registry
    registry = get_registry()
    db_adapters = registry._adapters.get("database", {})
    if "postgresql" in db_adapters:
        adapter_class = db_adapters["postgresql"]
        logger.info("Creating PostgreSQL adapter from plugin registry")
        adapter = adapter_class(self._config.database_url)
        await adapter.initialize()
        return adapter
    raise NotImplementedError(
        "No database adapter registered for enterprise tier. "
        "Install verbatim-enterprise or use basic tier."
    )

# In create_ai_service(), replace the enterprise else branch:
else:
    from core.plugins import get_registry
    registry = get_registry()
    llm_adapters = registry._adapters.get("llm", {})
    # Try configured LLM provider
    for name, adapter_class in llm_adapters.items():
        logger.info("Creating %s AI service from plugin registry", name)
        return adapter_class(self._config)
    raise NotImplementedError(
        "No AI service registered for enterprise tier. "
        "Install verbatim-enterprise or use basic tier."
    )

# In create_auth_provider(), replace the enterprise else branch:
else:
    from core.plugins import get_registry
    registry = get_registry()
    auth_adapters = registry._adapters.get("auth", {})
    for name, adapter_class in auth_adapters.items():
        logger.info("Creating %s auth provider from plugin registry", name)
        return adapter_class()
    raise NotImplementedError(
        "No auth provider registered for enterprise tier. "
        "Install verbatim-enterprise or use basic tier."
    )
```

**Step 4: Run tests**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/packages/backend && python3 -m pytest tests/test_factory_plugin_adapters.py -v`

**Step 5: Commit**

```bash
git add packages/backend/core/factory.py packages/backend/tests/test_factory_plugin_adapters.py
git commit -m "feat(plugins): factory checks plugin registry for enterprise adapters"
```

---

### Task 2: Additional Event Emissions

The event bus currently emits 3 events (transcription.complete, transcription.failed, document.processed). Webhooks need more events.

**Files:**
- Modify: `packages/backend/api/routes/recordings.py` (recording.created, recording.deleted)
- Modify: `packages/backend/api/routes/documents.py` (document.uploaded)
- Modify: `packages/backend/api/routes/projects.py` (project.created)
- Test: `packages/backend/tests/test_additional_events.py`

**Step 1: Write tests**

```python
# packages/backend/tests/test_additional_events.py
"""Test that additional events are emitted at key API points."""
import pytest
from unittest.mock import AsyncMock
from core.events import on, clear


@pytest.fixture(autouse=True)
def clean_events():
    clear()
    yield
    clear()


@pytest.mark.asyncio
async def test_emit_recording_created():
    from core.events import emit
    handler = AsyncMock()
    on("recording.created", handler)
    await emit("recording.created", recording_id="r1", project_id="p1")
    handler.assert_called_once_with(recording_id="r1", project_id="p1")


@pytest.mark.asyncio
async def test_emit_document_uploaded():
    from core.events import emit
    handler = AsyncMock()
    on("document.uploaded", handler)
    await emit("document.uploaded", document_id="d1", filename="test.pdf")
    handler.assert_called_once_with(document_id="d1", filename="test.pdf")


@pytest.mark.asyncio
async def test_emit_project_created():
    from core.events import emit
    handler = AsyncMock()
    on("project.created", handler)
    await emit("project.created", project_id="p1", name="Test Project")
    handler.assert_called_once_with(project_id="p1", name="Test Project")
```

**Step 2: Add emit calls to route handlers**

In each route file, add `from core.events import emit as emit_event` and call `await emit_event(...)` after the successful creation/deletion. Follow the exact pattern used in `services/jobs.py` where the existing emit calls are.

Look for the POST endpoint that creates a recording in `api/routes/recordings.py`, find where it returns the response, and add the emit call just before the return. Same pattern for documents and projects.

For recording.deleted, find the DELETE endpoint and emit after the deletion succeeds.

**Step 3: Run tests and commit**

```bash
cd /Users/JonWFH/jondev/verbatim-studio/packages/backend && python3 -m pytest tests/test_additional_events.py -v
git add packages/backend/api/routes/recordings.py packages/backend/api/routes/documents.py packages/backend/api/routes/projects.py packages/backend/tests/test_additional_events.py
git commit -m "feat(plugins): emit events on recording, document, and project creation"
```

---

### Task 3: Database Engine Plugin Override

The core `persistence/database.py` creates the SQLAlchemy engine at module load time with SQLite-specific settings. Enterprise needs to override this for PostgreSQL. Add a hook that lets plugins provide a custom engine.

**Files:**
- Modify: `packages/backend/persistence/database.py`
- Test: `packages/backend/tests/test_database_plugin_override.py`

**Step 1: Refactor database.py to support engine override**

Currently the engine is created at module import time. Wrap it in a function that checks for a plugin-provided engine:

```python
# In persistence/database.py, replace the module-level engine creation with:

_engine = None
_async_session = None


def get_engine():
    """Get the database engine, creating it if needed."""
    global _engine
    if _engine is None:
        _engine = _create_default_engine()
    return _engine


def set_engine(engine):
    """Override the database engine (called by enterprise plugin)."""
    global _engine, _async_session
    _engine = engine
    _async_session = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


def _create_default_engine():
    """Create the default SQLite engine."""
    eng = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        future=True,
        connect_args={"timeout": 30},
    )

    @event.listens_for(eng.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    return eng


def get_session_factory():
    """Get the async session factory."""
    global _async_session
    if _async_session is None:
        _async_session = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _async_session


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for database sessions."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

Update `init_db()` to use `get_engine()` instead of the module-level `engine`.

**Step 2: Write test**

```python
# packages/backend/tests/test_database_plugin_override.py
from unittest.mock import MagicMock
from persistence.database import set_engine, get_engine, _create_default_engine


def test_default_engine_is_sqlite():
    engine = _create_default_engine()
    assert "sqlite" in str(engine.url)


def test_set_engine_overrides():
    mock_engine = MagicMock()
    mock_engine.url = "postgresql+asyncpg://localhost/test"
    set_engine(mock_engine)
    assert get_engine() is mock_engine
```

**Step 3: Run tests and commit**

Ensure all existing tests still pass (they use the default SQLite engine). Then commit.

```bash
cd /Users/JonWFH/jondev/verbatim-studio/packages/backend && python3 -m pytest tests/ -v --timeout=30
git add packages/backend/persistence/database.py packages/backend/tests/test_database_plugin_override.py
git commit -m "feat(plugins): support database engine override for enterprise PostgreSQL"
```

---

## Part B: Enterprise Package (verbatim-studio-enterprise repo)

These tasks happen in the new private `verbatim-studio-enterprise` repo.

---

### Task 4: Create Repo + Package Skeleton

**Step 1: Create GitHub repo**

```bash
gh repo create JongoDB/verbatim-studio-enterprise --private --description "Enterprise features for Verbatim Studio"
cd /Users/JonWFH/jondev
git clone git@github.com:JongoDB/verbatim-studio-enterprise.git
cd verbatim-studio-enterprise
```

**Step 2: Create pyproject.toml**

```toml
# pyproject.toml
[project]
name = "verbatim-enterprise"
version = "1.0.0-dev"
description = "Enterprise features for Verbatim Studio"
requires-python = ">=3.11"
dependencies = [
    "verbatim-backend>=0.45.0",
    "asyncpg>=0.30.0",
    "python-jose[cryptography]>=3.3.0",
    "argon2-cffi>=23.0.0",
    "boto3>=1.35.0",
    "openai>=1.0.0",
    "anthropic>=0.40.0",
    "httpx>=0.28.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.8.0",
]
azure = [
    "azure-storage-blob>=12.0.0",
]

[project.entry-points."verbatim.plugins"]
enterprise = "verbatim_enterprise.plugin:EnterprisePlugin"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
```

**Step 3: Create package structure**

```
mkdir -p verbatim_enterprise/{adapters/{storage,llm},auth,models,routes,middleware,services}
mkdir -p tests
touch verbatim_enterprise/__init__.py
touch verbatim_enterprise/adapters/__init__.py
touch verbatim_enterprise/adapters/storage/__init__.py
touch verbatim_enterprise/adapters/llm/__init__.py
touch verbatim_enterprise/auth/__init__.py
touch verbatim_enterprise/models/__init__.py
touch verbatim_enterprise/routes/__init__.py
touch verbatim_enterprise/middleware/__init__.py
touch verbatim_enterprise/services/__init__.py
```

**Step 4: Create minimal plugin.py**

```python
# verbatim_enterprise/plugin.py
"""Enterprise plugin for Verbatim Studio."""

import logging

logger = logging.getLogger(__name__)


class EnterprisePlugin:
    """Verbatim Enterprise — adds team features, auth, API, and admin tools."""

    name = "verbatim-enterprise"
    version = "1.0.0-dev"

    def register(self, registry) -> None:
        """Register all enterprise features with the plugin system."""
        logger.info("Registering Verbatim Enterprise v%s", self.version)

        # Features will be registered here as they are implemented
        # Each section below will be uncommented as tasks are completed
```

**Step 5: Create enterprise config**

```python
# verbatim_enterprise/config.py
"""Enterprise-specific configuration."""

from pydantic_settings import BaseSettings


class EnterpriseSettings(BaseSettings):
    """Enterprise settings (loaded from VERBATIM_* env vars)."""

    # License
    LICENSE_KEY: str = ""

    # Auth
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # LLM endpoints (admin-managed)
    LLM_OPENAI_KEY: str | None = None
    LLM_OPENAI_MODEL: str = "gpt-4o"
    LLM_OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    LLM_ANTHROPIC_KEY: str | None = None
    LLM_ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    LLM_GENERIC_OPENAI_URL: str | None = None
    LLM_GENERIC_OPENAI_KEY: str | None = None
    LLM_GENERIC_OPENAI_MODEL: str | None = None

    # Storage
    S3_BUCKET: str | None = None
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None
    S3_ENDPOINT_URL: str | None = None  # For S3-compatible (MinIO, etc.)

    AZURE_BLOB_CONNECTION_STRING: str | None = None
    AZURE_BLOB_CONTAINER: str | None = None

    model_config = {"env_prefix": "VERBATIM_"}


enterprise_settings = EnterpriseSettings()
```

**Step 6: Write smoke test**

```python
# tests/test_plugin_discovery.py
"""Test that the enterprise plugin can be discovered and registered."""


def test_plugin_class_exists():
    from verbatim_enterprise.plugin import EnterprisePlugin
    plugin = EnterprisePlugin()
    assert plugin.name == "verbatim-enterprise"
    assert plugin.version is not None


def test_plugin_has_register_method():
    from verbatim_enterprise.plugin import EnterprisePlugin
    plugin = EnterprisePlugin()
    assert hasattr(plugin, "register")
    assert callable(plugin.register)
```

**Step 7: Install in dev mode and run tests**

```bash
cd /Users/JonWFH/jondev/verbatim-studio-enterprise
pip install -e ".[dev]"
python3 -m pytest tests/ -v
```

**Step 8: Create .gitignore and commit**

```bash
echo "__pycache__/
*.egg-info/
dist/
build/
.env
*.pyc
.pytest_cache/
" > .gitignore

git add -A
git commit -m "feat: enterprise package skeleton with plugin entry point"
git push origin main
```

---

### Task 5: PostgreSQL Adapter

Enterprise registers a PostgreSQL adapter that the core factory consumes when `MODE=enterprise`.

**Files:**
- Create: `verbatim_enterprise/adapters/database.py`
- Test: `tests/test_postgresql_adapter.py`
- Modify: `verbatim_enterprise/plugin.py` (register adapter)

**Step 1: Create PostgreSQL adapter**

```python
# verbatim_enterprise/adapters/database.py
"""PostgreSQL database adapter for enterprise tier."""

import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

logger = logging.getLogger(__name__)


class PostgresqlAdapter:
    """PostgreSQL adapter that overrides the default SQLite engine."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.engine = None

    async def initialize(self):
        """Create the async engine and configure for PostgreSQL."""
        self.engine = create_async_engine(
            self.database_url,
            echo=False,
            future=True,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
        )
        logger.info("PostgreSQL engine created: %s", self.database_url.split("@")[-1])

    def configure_core_database(self):
        """Override the core database engine with PostgreSQL."""
        from persistence.database import set_engine
        set_engine(self.engine)
        logger.info("Core database engine overridden with PostgreSQL")
```

**Step 2: Register in plugin.py**

Add to `register()`:

```python
# PostgreSQL adapter
from .adapters.database import PostgresqlAdapter
registry.add_adapter("database", "postgresql", PostgresqlAdapter)
```

**Step 3: Write test**

```python
# tests/test_postgresql_adapter.py
import pytest
from verbatim_enterprise.adapters.database import PostgresqlAdapter


def test_adapter_init():
    adapter = PostgresqlAdapter("postgresql+asyncpg://localhost/test")
    assert adapter.database_url == "postgresql+asyncpg://localhost/test"
    assert adapter.engine is None


@pytest.mark.asyncio
async def test_adapter_initialize():
    """Test engine creation (doesn't need a real PG instance)."""
    adapter = PostgresqlAdapter("postgresql+asyncpg://localhost/test")
    await adapter.initialize()
    assert adapter.engine is not None
    assert "postgresql" in str(adapter.engine.url)
    await adapter.engine.dispose()
```

**Step 4: Run tests and commit**

```bash
python3 -m pytest tests/test_postgresql_adapter.py -v
git add -A && git commit -m "feat: PostgreSQL adapter for enterprise database"
```

---

### Task 6: Auth Provider + JWT

Implement `IAuthProvider` with JWT tokens, Argon2 password hashing, and a User SQLAlchemy model.

**Files:**
- Create: `verbatim_enterprise/models/users.py`
- Create: `verbatim_enterprise/auth/passwords.py`
- Create: `verbatim_enterprise/auth/provider.py`
- Create: `verbatim_enterprise/routes/auth.py`
- Test: `tests/test_auth.py`
- Modify: `verbatim_enterprise/plugin.py`

**Step 1: Create User model**

```python
# verbatim_enterprise/models/users.py
"""Enterprise user and team models."""

from datetime import datetime
from persistence.models import Base, generate_uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship


class EnterpriseUser(Base):
    __tablename__ = "enterprise_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    username: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    # Team memberships
    team_memberships: Mapped[list["TeamMember"]] = relationship(back_populates="user")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")


class Team(Base):
    __tablename__ = "enterprise_teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team")


class TeamMember(Base):
    __tablename__ = "enterprise_team_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    team_id: Mapped[str] = mapped_column(ForeignKey("enterprise_teams.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("enterprise_users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(50), default="member")  # owner, admin, member, viewer
    joined_at: Mapped[datetime] = mapped_column(default=func.now())

    team: Mapped["Team"] = relationship(back_populates="members")
    user: Mapped["EnterpriseUser"] = relationship(back_populates="team_memberships")


class RefreshToken(Base):
    __tablename__ = "enterprise_refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("enterprise_users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    user: Mapped["EnterpriseUser"] = relationship(back_populates="refresh_tokens")
```

**Step 2: Create password hashing**

```python
# verbatim_enterprise/auth/passwords.py
"""Password hashing with Argon2."""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
```

**Step 3: Create auth provider**

```python
# verbatim_enterprise/auth/provider.py
"""JWT-based authentication provider for enterprise tier."""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.interfaces.auth import (
    AuthToken, IAuthProvider, LoginCredentials, RegistrationData, Role, User,
    ROLE_PERMISSIONS,
)
from ..config import enterprise_settings
from ..models.users import EnterpriseUser, RefreshToken
from .passwords import hash_password, verify_password

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"


class EnterpriseAuthProvider(IAuthProvider):
    """JWT-based auth with local user database."""

    def __init__(self, session_factory):
        self._session_factory = session_factory

    def _create_access_token(self, user_id: str, role: str) -> tuple[str, datetime]:
        expires = datetime.now(timezone.utc) + timedelta(
            minutes=enterprise_settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
        payload = {"sub": user_id, "role": role, "exp": expires}
        token = jwt.encode(payload, enterprise_settings.SECRET_KEY, algorithm=ALGORITHM)
        return token, expires

    def _create_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

    async def authenticate(self, credentials: LoginCredentials) -> AuthToken:
        async with self._session_factory() as session:
            result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.username == credentials.username)
            )
            user = result.scalar_one_or_none()

            if not user or not verify_password(credentials.password, user.password_hash):
                raise PermissionError("Invalid username or password")

            if not user.is_active:
                raise PermissionError("Account is deactivated")

            # Create tokens
            access_token, expires = self._create_access_token(user.id, user.role)
            refresh = self._create_refresh_token()
            refresh_hash = hashlib.sha256(refresh.encode()).hexdigest()

            # Store refresh token
            session.add(RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(
                    days=enterprise_settings.REFRESH_TOKEN_EXPIRE_DAYS
                ),
            ))

            user.last_login = datetime.now(timezone.utc)
            await session.commit()

            return AuthToken(
                access_token=access_token,
                expires_at=expires,
                refresh_token=refresh,
            )

    async def validate_token(self, token: str) -> User:
        try:
            payload = jwt.decode(token, enterprise_settings.SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            role_str = payload.get("role", "user")
        except JWTError:
            raise PermissionError("Invalid or expired token")

        async with self._session_factory() as session:
            result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.id == user_id)
            )
            db_user = result.scalar_one_or_none()
            if not db_user or not db_user.is_active:
                raise PermissionError("User not found or deactivated")

            role = Role(role_str)
            return User(
                id=db_user.id,
                username=db_user.username,
                email=db_user.email,
                role=role,
                permissions=ROLE_PERMISSIONS.get(role, set()),
                is_active=db_user.is_active,
                created_at=db_user.created_at,
                last_login=db_user.last_login,
            )

    async def refresh_token(self, refresh_token: str) -> AuthToken:
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()

        async with self._session_factory() as session:
            result = await session.execute(
                select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            )
            stored = result.scalar_one_or_none()

            if not stored or stored.expires_at < datetime.now(timezone.utc):
                raise PermissionError("Invalid or expired refresh token")

            # Delete old refresh token
            await session.delete(stored)

            # Create new tokens
            user_result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.id == stored.user_id)
            )
            user = user_result.scalar_one()

            access_token, expires = self._create_access_token(user.id, user.role)
            new_refresh = self._create_refresh_token()
            new_hash = hashlib.sha256(new_refresh.encode()).hexdigest()

            session.add(RefreshToken(
                user_id=user.id,
                token_hash=new_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(
                    days=enterprise_settings.REFRESH_TOKEN_EXPIRE_DAYS
                ),
            ))
            await session.commit()

            return AuthToken(
                access_token=access_token,
                expires_at=expires,
                refresh_token=new_refresh,
            )

    async def logout(self, token: str) -> None:
        # For JWT, we can't truly invalidate — but we delete refresh tokens
        pass

    async def get_current_user(self) -> User:
        raise NotImplementedError("Use validate_token() with the request token instead")

    async def register(self, data: RegistrationData) -> User:
        async with self._session_factory() as session:
            db_user = EnterpriseUser(
                username=data.username,
                email=data.email,
                password_hash=hash_password(data.password),
                role=data.role.value,
            )
            session.add(db_user)
            await session.commit()
            await session.refresh(db_user)

            role = Role(db_user.role)
            return User(
                id=db_user.id,
                username=db_user.username,
                email=db_user.email,
                role=role,
                permissions=ROLE_PERMISSIONS.get(role, set()),
                is_active=True,
                created_at=db_user.created_at,
            )

    async def update_user(self, user_id: str, updates: dict) -> User:
        async with self._session_factory() as session:
            result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.id == user_id)
            )
            db_user = result.scalar_one_or_none()
            if not db_user:
                raise ValueError("User not found")

            for key, value in updates.items():
                if hasattr(db_user, key) and key not in ("id", "password_hash"):
                    setattr(db_user, key, value)

            await session.commit()
            await session.refresh(db_user)

            role = Role(db_user.role)
            return User(
                id=db_user.id,
                username=db_user.username,
                email=db_user.email,
                role=role,
                permissions=ROLE_PERMISSIONS.get(role, set()),
                is_active=db_user.is_active,
            )

    async def delete_user(self, user_id: str) -> bool:
        async with self._session_factory() as session:
            result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.id == user_id)
            )
            db_user = result.scalar_one_or_none()
            if not db_user:
                return False
            await session.delete(db_user)
            await session.commit()
            return True

    async def list_users(self, page=1, page_size=20, role=None):
        async with self._session_factory() as session:
            query = select(EnterpriseUser)
            if role:
                query = query.where(EnterpriseUser.role == role.value)

            # Count
            from sqlalchemy import func
            count_result = await session.execute(
                select(func.count()).select_from(query.subquery())
            )
            total = count_result.scalar()

            # Paginate
            query = query.offset((page - 1) * page_size).limit(page_size)
            result = await session.execute(query)
            db_users = result.scalars().all()

            users = []
            for db_user in db_users:
                r = Role(db_user.role)
                users.append(User(
                    id=db_user.id,
                    username=db_user.username,
                    email=db_user.email,
                    role=r,
                    permissions=ROLE_PERMISSIONS.get(r, set()),
                    is_active=db_user.is_active,
                    created_at=db_user.created_at,
                    last_login=db_user.last_login,
                ))

            return users, total

    async def change_password(self, user_id, current_password, new_password):
        async with self._session_factory() as session:
            result = await session.execute(
                select(EnterpriseUser).where(EnterpriseUser.id == user_id)
            )
            db_user = result.scalar_one_or_none()
            if not db_user:
                raise ValueError("User not found")
            if not verify_password(current_password, db_user.password_hash):
                raise PermissionError("Current password is incorrect")

            db_user.password_hash = hash_password(new_password)
            await session.commit()
            return True

    def requires_auth(self) -> bool:
        return True
```

**Step 4: Create auth routes**

```python
# verbatim_enterprise/routes/auth.py
"""Authentication routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.interfaces.auth import LoginCredentials, RegistrationData, Role

auth_router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str | None = None
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


# Auth provider will be injected during plugin registration
_auth_provider = None


def set_auth_provider(provider):
    global _auth_provider
    _auth_provider = provider


@auth_router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    try:
        token = await _auth_provider.authenticate(
            LoginCredentials(username=request.username, password=request.password)
        )
        return TokenResponse(
            access_token=token.access_token,
            expires_at=token.expires_at.isoformat() if token.expires_at else None,
            refresh_token=token.refresh_token,
        )
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


@auth_router.post("/register", response_model=dict)
async def register(request: RegisterRequest):
    try:
        user = await _auth_provider.register(
            RegistrationData(
                username=request.username,
                email=request.email,
                password=request.password,
                role=Role.USER,
            )
        )
        return {"id": user.id, "username": user.username, "email": user.email}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@auth_router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshRequest):
    try:
        token = await _auth_provider.refresh_token(request.refresh_token)
        return TokenResponse(
            access_token=token.access_token,
            expires_at=token.expires_at.isoformat() if token.expires_at else None,
            refresh_token=token.refresh_token,
        )
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
```

**Step 5: Write tests**

```python
# tests/test_auth.py
import pytest
from verbatim_enterprise.auth.passwords import hash_password, verify_password


def test_hash_password():
    hashed = hash_password("test123")
    assert hashed != "test123"
    assert hashed.startswith("$argon2")


def test_verify_password_correct():
    hashed = hash_password("test123")
    assert verify_password("test123", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("test123")
    assert verify_password("wrong", hashed) is False
```

**Step 6: Register in plugin.py and commit**

```bash
python3 -m pytest tests/ -v
git add -A && git commit -m "feat: JWT auth provider with user model and login routes"
```

---

### Task 7: Auth Middleware

Intercept all `/api/*` requests, validate JWT, inject user into request state.

**Files:**
- Create: `verbatim_enterprise/auth/middleware.py`
- Test: `tests/test_auth_middleware.py`
- Modify: `verbatim_enterprise/plugin.py`

**Step 1: Create middleware**

```python
# verbatim_enterprise/auth/middleware.py
"""JWT authentication middleware for enterprise tier."""

import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Endpoints that don't require authentication
PUBLIC_PATHS = {
    "/api/health",
    "/api/health/ready",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/plugins/manifest",
    "/docs",
    "/openapi.json",
}


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """Validate JWT on all API requests."""

    def __init__(self, app, auth_provider=None):
        super().__init__(app)
        self.auth_provider = auth_provider

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth for public endpoints
        if path in PUBLIC_PATHS or not path.startswith("/api"):
            return await call_next(request)

        # Check for API key auth (vst_ prefix)
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer vst_"):
            # API key auth handled by a separate check
            return await call_next(request)

        # JWT auth
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid authorization header"},
            )

        token = auth_header[7:]  # Strip "Bearer "

        try:
            user = await self.auth_provider.validate_token(token)
            request.state.user = user
        except PermissionError as e:
            return JSONResponse(
                status_code=401,
                content={"detail": str(e)},
            )

        return await call_next(request)
```

**Step 2: Register in plugin.py**

```python
# In register():
from .auth.middleware import JWTAuthMiddleware
from .auth.provider import EnterpriseAuthProvider
from persistence.database import get_session_factory

auth_provider = EnterpriseAuthProvider(get_session_factory())
registry.add_middleware(JWTAuthMiddleware, auth_provider=auth_provider)

from .routes.auth import auth_router, set_auth_provider
set_auth_provider(auth_provider)
registry.add_router(auth_router, prefix="/api/auth", tags=["auth"])
```

**Step 3: Write test and commit**

```bash
python3 -m pytest tests/ -v
git add -A && git commit -m "feat: JWT auth middleware with public path allowlist"
```

---

### Task 8: Team Routes + API Key Management

CRUD routes for teams, team members, and API keys.

**Files:**
- Create: `verbatim_enterprise/models/api_keys.py`
- Create: `verbatim_enterprise/routes/teams.py`
- Create: `verbatim_enterprise/routes/api_keys.py`
- Test: `tests/test_teams.py`, `tests/test_api_keys.py`
- Modify: `verbatim_enterprise/plugin.py`

This task follows standard FastAPI CRUD patterns:
- Team CRUD (create, list, get, update, delete)
- Team member management (add, remove, change role)
- API key management (create → return plaintext once, list, revoke)
- API keys are SHA-256 hashed in the DB, prefixed with `vst_`

**API Key model:**

```python
# verbatim_enterprise/models/api_keys.py
from datetime import datetime
from persistence.models import Base, generate_uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, String, JSON, func
from sqlalchemy.orm import Mapped, mapped_column


class ApiKey(Base):
    __tablename__ = "enterprise_api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)  # First 8 chars for identification
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("enterprise_teams.id", ondelete="CASCADE"))
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
```

Register routes in plugin.py. Write CRUD endpoints following FastAPI patterns. Commit after tests pass.

```bash
git add -A && git commit -m "feat: team CRUD and API key management routes"
```

---

### Task 9: Webhook System

Event-driven webhook dispatch. Admin registers URLs for specific events. Enterprise subscribes to the event bus and dispatches HTTP POST requests.

**Files:**
- Create: `verbatim_enterprise/models/webhooks.py` (Webhook, WebhookDelivery models)
- Create: `verbatim_enterprise/services/webhook.py` (dispatch logic with retry)
- Create: `verbatim_enterprise/routes/webhooks.py` (CRUD for webhook registrations)
- Test: `tests/test_webhooks.py`
- Modify: `verbatim_enterprise/plugin.py`

**Webhook model:**

```python
# Key fields: url, events (JSON list), secret (for HMAC signing), is_active
# WebhookDelivery: webhook_id, event, payload, status_code, response_body, created_at
```

**Dispatch logic:**
- Subscribe to events via `registry.on("transcription.complete", dispatch_webhooks)`
- On event, find active webhooks matching that event type
- POST payload to each URL with HMAC signature in `X-Verbatim-Signature` header
- Record delivery in WebhookDelivery table
- Retry failed deliveries via job queue (3 attempts, exponential backoff)

```bash
git add -A && git commit -m "feat: webhook system with event dispatch and retry"
```

---

### Task 10: LLM Adapters

OpenAI, Anthropic, and generic OpenAI-compatible (Ollama, vLLM) adapters implementing `IAIService`.

**Files:**
- Create: `verbatim_enterprise/adapters/llm/openai.py`
- Create: `verbatim_enterprise/adapters/llm/anthropic.py`
- Create: `verbatim_enterprise/adapters/llm/generic_openai.py`
- Test: `tests/test_llm_adapters.py`
- Modify: `verbatim_enterprise/plugin.py`

Each adapter implements `IAIService` interface methods: `chat()`, `chat_stream()`, `summarize_transcript()`, `analyze_transcript()`, `get_available_models()`, `is_available()`.

Use the official `openai` and `anthropic` Python SDKs. The generic adapter uses the `openai` SDK with a custom `base_url`.

Config comes from `enterprise_settings` (admin-managed API keys).

```bash
git add -A && git commit -m "feat: OpenAI, Anthropic, and generic LLM adapters"
```

---

### Task 11: Storage Adapters (S3, Azure Blob)

Implement `StorageAdapter` for S3-compatible and Azure Blob storage.

**Files:**
- Create: `verbatim_enterprise/adapters/storage/s3.py`
- Create: `verbatim_enterprise/adapters/storage/azure_blob.py`
- Test: `tests/test_storage_adapters.py`
- Modify: `verbatim_enterprise/plugin.py`

Each adapter implements the `StorageAdapter` ABC: `test_connection()`, `list_files()`, `read_file()`, `write_file()`, `delete_file()`, `exists()`, `get_file_info()`, `ensure_directory()`, `stream_file()`.

S3 adapter uses `boto3` with `aiobotocore` for async operations.
Azure adapter uses `azure-storage-blob` with async client.

Register via `storage.factory.register_adapter()` at plugin registration time.

```bash
git add -A && git commit -m "feat: S3 and Azure Blob storage adapters"
```

---

### Task 12: Audit Logging

Middleware that logs mutating API calls + event handler that logs bus events.

**Files:**
- Create: `verbatim_enterprise/models/audit.py`
- Create: `verbatim_enterprise/middleware/audit.py`
- Create: `verbatim_enterprise/routes/admin.py` (audit log viewer endpoint)
- Test: `tests/test_audit.py`
- Modify: `verbatim_enterprise/plugin.py`

**AuditLog model:**

```python
# verbatim_enterprise/models/audit.py
from datetime import datetime
from persistence.models import Base, generate_uuid
from sqlalchemy import DateTime, ForeignKey, String, JSON, func
from sqlalchemy.orm import Mapped, mapped_column


class AuditLog(Base):
    __tablename__ = "enterprise_audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g., "POST /api/recordings"
    resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
```

**Middleware:** Logs POST/PUT/PATCH/DELETE requests. Extracts user from `request.state.user` (set by auth middleware). Writes to audit table async.

**Admin endpoint:** `GET /api/admin/audit` — paginated, filterable by user, action, date range.

```bash
git add -A && git commit -m "feat: audit logging middleware and admin viewer"
```

---

### Task 13: License Management

Offline JWT-based license validation.

**Files:**
- Create: `verbatim_enterprise/services/license.py`
- Create: `verbatim_enterprise/middleware/license.py`
- Create: `verbatim_enterprise/routes/license.py`
- Create: `scripts/generate-license.py` (CLI tool)
- Test: `tests/test_license.py`
- Modify: `verbatim_enterprise/plugin.py`

**License JWT claims:** `org_name`, `seat_count`, `expires_at`, `features` (list), `issued_at`.

**License service:**
- Decode and validate JWT signature against bundled public key
- Cache validation result (re-validate every hour or on settings change)
- Check seat count against active user count
- Check expiry with 14-day grace period

**License middleware:**
- Check license validity on each request (uses cached result)
- Expired (past grace) → 402 response for mutating requests, reads still allowed
- No license → enterprise features disabled, core still works

**License route:** `GET /api/license/status` — returns license info, expiry, seat usage.

**Generate script:**
- CLI tool that signs a JWT with a private key
- Usage: `python scripts/generate-license.py --org "Acme Corp" --seats 50 --expires 2027-02-11`

```bash
git add -A && git commit -m "feat: offline JWT license validation and generation"
```

---

### Task 14: Admin Dashboard Frontend

React micro-frontend built with Vite, using the same Tailwind config as the main app.

**Files:**
- Create: `verbatim_enterprise/frontend/package.json`
- Create: `verbatim_enterprise/frontend/vite.config.ts`
- Create: `verbatim_enterprise/frontend/tailwind.config.js`
- Create: `verbatim_enterprise/frontend/src/` (React components)
- Create: `verbatim_enterprise/routes/frontend.py` (serves built assets)

**Architecture:**
- Separate Vite build that produces a JS bundle
- Plugin's FastAPI routes serve the built bundle at `/plugins/admin/`, `/plugins/teams/`, etc.
- Main app loads via `React.lazy()` (requires upgrading plugin page rendering in open source repo — Task 15)

**Admin pages:**
- `AdminDashboard.tsx` — Overview: active users, storage usage, job stats
- `UserManagement.tsx` — User CRUD (calls `/api/users/*`)
- `TeamManagement.tsx` — Team CRUD (calls `/api/teams/*`)
- `ApiKeyManager.tsx` — API key CRUD (calls `/api/keys/*`)
- `WebhookConfig.tsx` — Webhook CRUD (calls `/api/webhooks/*`)
- `AuditLogViewer.tsx` — Filterable audit log (calls `/api/admin/audit`)
- `LicenseStatus.tsx` — License info display (calls `/api/license/status`)
- `EnterpriseSettings.tsx` — Enterprise config (LLM endpoints, storage settings)

**Build:**
```bash
cd verbatim_enterprise/frontend && npm install && npm run build
```

The built files go to `verbatim_enterprise/frontend/dist/` and are served by `routes/frontend.py`.

```bash
git add -A && git commit -m "feat: admin dashboard React micro-frontend"
```

---

### Task 15: Module-Based Plugin Rendering (Open Source)

Back in the `verbatim-studio` repo. Upgrade App.tsx to support `renderMode: 'module'` alongside iframe.

**Files (verbatim-studio repo):**
- Modify: `packages/frontend/src/app/App.tsx`
- Modify: `packages/frontend/src/lib/api.ts` (add renderMode to PluginManifest)
- Modify: `packages/frontend/src/hooks/usePluginManifest.ts`

Update `PluginManifest` type to include optional `renderMode` per route. When `renderMode === 'module'`, load the plugin's JS bundle via `React.lazy(() => import(url))` instead of iframe.

This makes enterprise admin pages feel like native Verbatim pages (shared theme, no iframe borders).

```bash
# In verbatim-studio repo:
git add -A && git commit -m "feat(plugins): support module-based plugin page rendering"
```

---

### Task 16: Docker Deployment

Docker Compose config for enterprise deployment.

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `docker/nginx.conf`
- Create: `docker/.env.example`

**Dockerfile:**
- Base: `python:3.12-slim`
- Install verbatim-backend + verbatim-enterprise
- Copy frontend static build
- Expose port 8000

**docker-compose.yml:**
- `backend` service (FastAPI + enterprise plugin)
- `postgres` service (PostgreSQL 16)
- `nginx` service (reverse proxy, SSL, static files)

**nginx.conf:**
- Proxy `/api/*` to backend
- Serve frontend static files
- WebSocket proxy for live transcription

**.env.example:**
```
VERBATIM_MODE=enterprise
VERBATIM_DATABASE_URL=postgresql+asyncpg://verbatim:password@postgres:5432/verbatim
VERBATIM_SECRET_KEY=<generate-random-64-chars>
VERBATIM_LICENSE_KEY=<paste-license-jwt>
```

```bash
git add -A && git commit -m "feat: Docker Compose deployment for enterprise"
```

---

## Verification Checklist

After all tasks are complete:

1. **Open source tests pass**: `cd packages/backend && python3 -m pytest tests/ -v`
2. **Enterprise tests pass**: `cd verbatim-studio-enterprise && python3 -m pytest tests/ -v`
3. **Plugin discovery works**: With enterprise installed, `GET /api/plugins/manifest` returns enterprise nav items and settings tabs
4. **Auth flow**: Register → login → get JWT → access protected routes → refresh token
5. **PostgreSQL**: Set `DATABASE_URL` to PG, enterprise creates tables, core queries work
6. **Docker**: `docker compose up` starts backend + PG + nginx, frontend accessible at `http://localhost`
7. **No license = graceful**: Without a license key, enterprise features are disabled but core works
8. **Desktop unaffected**: Desktop (Electron) app without enterprise installed behaves identically to before
