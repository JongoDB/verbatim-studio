"""Test that AdapterFactory can consume plugin-registered adapters."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from core.factory import AdapterFactory, AdapterConfig
from core.plugins import PluginRegistry


@pytest.fixture(autouse=True)
def reset_registry():
    """Reset plugin registry between tests."""
    import core.plugins as plugins_mod
    old = plugins_mod._registry
    plugins_mod._registry = PluginRegistry()
    yield plugins_mod._registry
    plugins_mod._registry = old


@pytest.mark.asyncio
async def test_enterprise_database_adapter_from_registry(reset_registry):
    """When a database adapter is registered via plugin, factory should use it."""
    mock_adapter_class = MagicMock()
    mock_instance = AsyncMock()
    mock_adapter_class.return_value = mock_instance

    reset_registry.add_adapter("database", "postgresql", mock_adapter_class)

    config = AdapterConfig(database_url="postgresql+asyncpg://localhost/test")
    factory = AdapterFactory("enterprise", config)

    result = await factory.create_database_adapter()

    mock_adapter_class.assert_called_once_with("postgresql+asyncpg://localhost/test")
    mock_instance.initialize.assert_awaited_once()
    assert result is mock_instance


def test_enterprise_ai_adapter_from_registry(reset_registry):
    """When an AI adapter is registered via plugin, factory should use it."""
    mock_adapter_class = MagicMock()
    mock_instance = MagicMock()
    mock_adapter_class.return_value = mock_instance

    reset_registry.add_adapter("llm", "openai", mock_adapter_class)

    config = AdapterConfig(database_url="sqlite+aiosqlite:///./test.db")
    factory = AdapterFactory("enterprise", config)

    result = factory.create_ai_service()

    mock_adapter_class.assert_called_once_with(config)
    assert result is mock_instance


def test_enterprise_auth_adapter_from_registry(reset_registry):
    """When an auth adapter is registered via plugin, factory should use it."""
    mock_adapter_class = MagicMock()
    mock_instance = MagicMock()
    mock_adapter_class.return_value = mock_instance

    reset_registry.add_adapter("auth", "enterprise", mock_adapter_class)

    config = AdapterConfig(database_url="sqlite+aiosqlite:///./test.db")
    factory = AdapterFactory("enterprise", config)

    result = factory.create_auth_provider()

    mock_adapter_class.assert_called_once_with()
    assert result is mock_instance


def test_basic_tier_ignores_plugin_adapters(reset_registry):
    """Basic tier should still use built-in adapters, not plugin ones."""
    mock_adapter_class = MagicMock()
    reset_registry.add_adapter("database", "postgresql", mock_adapter_class)

    config = AdapterConfig(database_url="sqlite+aiosqlite:///./test.db")
    factory = AdapterFactory("basic", config)
    assert factory.is_basic
    # Mock was registered but basic tier shouldn't call it
    mock_adapter_class.assert_not_called()
