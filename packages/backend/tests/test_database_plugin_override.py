"""Test that the database engine can be overridden by plugins."""
import pytest
from unittest.mock import MagicMock
import persistence.database as db_module


@pytest.fixture(autouse=True)
def restore_engine():
    """Save and restore the original engine/session after each test."""
    original_engine = db_module.engine
    original_session = db_module.async_session
    yield
    db_module.engine = original_engine
    db_module.async_session = original_session


def test_get_engine_returns_default():
    """Default engine should be SQLite."""
    engine = db_module.get_engine()
    assert "sqlite" in str(engine.url)


def test_set_engine_overrides():
    """set_engine should replace the module-level engine and session factory."""
    mock_engine = MagicMock()
    mock_engine.url = "postgresql+asyncpg://localhost/test"

    db_module.set_engine(mock_engine)

    assert db_module.get_engine() is mock_engine
    assert db_module.engine is mock_engine
    # Session factory should also be updated
    assert db_module.async_session is not None


def test_get_session_factory_returns_current():
    """get_session_factory should return the current session factory."""
    factory = db_module.get_session_factory()
    assert factory is db_module.async_session
