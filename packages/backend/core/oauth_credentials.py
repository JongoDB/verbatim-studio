"""OAuth credentials management with DB persistence."""

import logging
from typing import Any

from sqlalchemy import select

from core.config import settings as env_settings
from persistence.database import get_session_factory
from persistence.models import Setting
from services.encryption import encrypt_config, decrypt_config

logger = logging.getLogger(__name__)

# Supported OAuth providers
OAUTH_PROVIDERS = ["gdrive", "onedrive", "dropbox"]

# Provider display info
PROVIDER_INFO = {
    "gdrive": {
        "name": "Google Drive",
        "setup_url": "https://console.cloud.google.com/apis/credentials",
        "docs_url": "https://developers.google.com/drive/api/quickstart/python",
    },
    "onedrive": {
        "name": "Microsoft OneDrive",
        "setup_url": "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
        "docs_url": "https://docs.microsoft.com/en-us/onedrive/developer/rest-api/getting-started/app-registration",
    },
    "dropbox": {
        "name": "Dropbox",
        "setup_url": "https://www.dropbox.com/developers/apps",
        "docs_url": "https://www.dropbox.com/developers/documentation/python",
    },
}


async def get_oauth_credentials(provider: str | None = None) -> dict[str, Any]:
    """Get OAuth credentials for one or all providers.

    Fallback chain: DB setting → env var.

    Args:
        provider: Optional provider name. If None, returns all providers.

    Returns:
        Dict with client_id and has_secret (never exposes actual secret).
    """
    # Get env var credentials as fallback
    env_credentials = {
        "gdrive": {
            "client_id": env_settings.GOOGLE_CLIENT_ID,
            "client_secret": env_settings.GOOGLE_CLIENT_SECRET,
        },
        "onedrive": {
            "client_id": env_settings.MICROSOFT_CLIENT_ID,
            "client_secret": env_settings.MICROSOFT_CLIENT_SECRET,
        },
        "dropbox": {
            "client_id": env_settings.DROPBOX_CLIENT_ID,
            "client_secret": env_settings.DROPBOX_CLIENT_SECRET,
        },
    }

    # Try to get DB credentials
    db_credentials = {}
    try:
        async with get_session_factory()() as session:
            result = await session.execute(
                select(Setting).where(Setting.key == "oauth_credentials")
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                # Decrypt the stored credentials
                db_credentials = decrypt_config(setting.value)
    except Exception as e:
        logger.warning("Failed to read OAuth credentials from DB", exc_info=True)

    # Merge credentials (DB takes precedence)
    result = {}
    providers = [provider] if provider else OAUTH_PROVIDERS

    for p in providers:
        if p not in OAUTH_PROVIDERS:
            continue

        # Start with env vars
        creds = env_credentials.get(p, {})

        # Override with DB values
        if p in db_credentials:
            db_creds = db_credentials[p]
            if db_creds.get("client_id"):
                creds["client_id"] = db_creds["client_id"]
            if db_creds.get("client_secret"):
                creds["client_secret"] = db_creds["client_secret"]

        # Build safe response (never expose full secret)
        result[p] = {
            "client_id": creds.get("client_id") or "",
            "has_secret": bool(creds.get("client_secret")),
            "configured": bool(creds.get("client_id") and creds.get("client_secret")),
            **PROVIDER_INFO.get(p, {}),
        }

    return result if not provider else result.get(provider, {})


async def get_oauth_credentials_raw(provider: str) -> dict[str, str | None]:
    """Get raw OAuth credentials (including secret) for internal use.

    This should only be called by the OAuth service, never exposed via API.

    Args:
        provider: Provider name (gdrive, onedrive, dropbox).

    Returns:
        Dict with client_id and client_secret (may be None).
    """
    # Get env var credentials as fallback
    env_map = {
        "gdrive": (env_settings.GOOGLE_CLIENT_ID, env_settings.GOOGLE_CLIENT_SECRET),
        "onedrive": (env_settings.MICROSOFT_CLIENT_ID, env_settings.MICROSOFT_CLIENT_SECRET),
        "dropbox": (env_settings.DROPBOX_CLIENT_ID, env_settings.DROPBOX_CLIENT_SECRET),
    }

    env_id, env_secret = env_map.get(provider, (None, None))

    # Try DB first
    try:
        async with get_session_factory()() as session:
            result = await session.execute(
                select(Setting).where(Setting.key == "oauth_credentials")
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                db_credentials = decrypt_config(setting.value)
                if provider in db_credentials:
                    db_creds = db_credentials[provider]
                    return {
                        "client_id": db_creds.get("client_id") or env_id,
                        "client_secret": db_creds.get("client_secret") or env_secret,
                    }
    except Exception as e:
        logger.warning("Failed to read OAuth credentials from DB", exc_info=True)

    # Fall back to env vars
    return {
        "client_id": env_id,
        "client_secret": env_secret,
    }


async def save_oauth_credentials(provider: str, client_id: str, client_secret: str) -> dict[str, Any]:
    """Save OAuth credentials for a provider.

    Credentials are encrypted before storage.

    Args:
        provider: Provider name (gdrive, onedrive, dropbox).
        client_id: OAuth client ID.
        client_secret: OAuth client secret.

    Returns:
        Updated credentials info (without exposing secret).
    """
    if provider not in OAUTH_PROVIDERS:
        raise ValueError(f"Invalid provider: {provider}")

    async with get_session_factory()() as session:
        result = await session.execute(
            select(Setting).where(Setting.key == "oauth_credentials")
        )
        setting = result.scalar_one_or_none()

        if setting:
            # Decrypt existing, update, re-encrypt
            existing = decrypt_config(setting.value) if setting.value else {}
            existing[provider] = {
                "client_id": client_id,
                "client_secret": client_secret,
            }
            setting.value = encrypt_config(existing)
        else:
            # Create new
            new_creds = {
                provider: {
                    "client_id": client_id,
                    "client_secret": client_secret,
                }
            }
            setting = Setting(key="oauth_credentials", value=encrypt_config(new_creds))
            session.add(setting)

        await session.commit()

    # Return safe response
    return {
        "client_id": client_id,
        "has_secret": True,
        "configured": True,
        **PROVIDER_INFO.get(provider, {}),
    }


async def delete_oauth_credentials(provider: str) -> bool:
    """Delete OAuth credentials for a provider.

    Args:
        provider: Provider name.

    Returns:
        True if deleted, False if not found.
    """
    if provider not in OAUTH_PROVIDERS:
        raise ValueError(f"Invalid provider: {provider}")

    async with get_session_factory()() as session:
        result = await session.execute(
            select(Setting).where(Setting.key == "oauth_credentials")
        )
        setting = result.scalar_one_or_none()

        if not setting or not setting.value:
            return False

        existing = decrypt_config(setting.value)
        if provider not in existing:
            return False

        del existing[provider]
        setting.value = encrypt_config(existing) if existing else {}
        await session.commit()
        return True
