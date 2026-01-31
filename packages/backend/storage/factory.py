"""Storage adapter factory."""

from persistence.models import StorageLocation
from services.encryption import decrypt_config
from storage.base import StorageAdapter
from storage.adapters.local import LocalAdapter
from storage.adapters.gdrive import GDriveAdapter


# Registry of adapter classes by (type, subtype)
ADAPTER_REGISTRY: dict[tuple[str, str | None], type[StorageAdapter]] = {
    ("local", None): LocalAdapter,
    ("cloud", "gdrive"): GDriveAdapter,
}


def get_adapter(location: StorageLocation) -> StorageAdapter:
    """Get appropriate storage adapter for a location.

    Args:
        location: StorageLocation model instance.

    Returns:
        Configured StorageAdapter instance.

    Raises:
        ValueError: If storage type is not supported.
    """
    key = (location.type, location.subtype)

    # Try exact match first
    adapter_class = ADAPTER_REGISTRY.get(key)

    # Fall back to type-only match
    if adapter_class is None:
        adapter_class = ADAPTER_REGISTRY.get((location.type, None))

    if adapter_class is None:
        raise ValueError(
            f"Unknown storage type: {location.type}/{location.subtype}"
        )

    # Decrypt credentials before passing to adapter
    config = decrypt_config(location.config or {})

    return adapter_class(config)


def register_adapter(
    storage_type: str,
    subtype: str | None,
    adapter_class: type[StorageAdapter]
) -> None:
    """Register an adapter class for a storage type."""
    ADAPTER_REGISTRY[(storage_type, subtype)] = adapter_class
