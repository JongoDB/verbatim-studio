"""AI settings helper with DB persistence and fallback chain."""

import logging
from typing import Any

from sqlalchemy import select

from core.config import settings as env_settings
from persistence.database import get_session_factory
from persistence.models import Setting

logger = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {
    "context_size": 8192,
}

VALID_CONTEXT_SIZES = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

CONTEXT_RAM_ESTIMATES: dict[int, str] = {
    2048: "~5 GB",
    4096: "~5.5 GB",
    8192: "~6 GB",
    16384: "~7 GB",
    32768: "~9 GB",
    65536: "~13 GB",
    131072: "~21 GB",
}


async def get_ai_settings() -> dict[str, Any]:
    """Get effective AI settings. Fallback chain: DB -> env -> default."""
    effective = dict(DEFAULTS)

    # Layer 2: env var overrides
    if env_settings.AI_N_CTX != 8192:
        effective["context_size"] = env_settings.AI_N_CTX

    # Layer 3: DB overrides (highest priority)
    try:
        async with get_session_factory()() as session:
            result = await session.execute(
                select(Setting).where(Setting.key == "ai")
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                if "context_size" in setting.value:
                    effective["context_size"] = int(setting.value["context_size"])
    except Exception:
        logger.warning("Failed to read AI settings from DB, using defaults", exc_info=True)

    return effective


async def save_ai_settings(updates: dict[str, Any]) -> dict[str, Any]:
    """Save AI settings to DB. Merges with existing values. Returns saved dict."""
    async with get_session_factory()() as session:
        result = await session.execute(
            select(Setting).where(Setting.key == "ai")
        )
        setting = result.scalar_one_or_none()

        if setting:
            merged = dict(setting.value)
            for key, value in updates.items():
                if key in DEFAULTS:
                    merged[key] = value
            setting.value = merged
        else:
            merged = {}
            for key, value in updates.items():
                if key in DEFAULTS:
                    merged[key] = value
            setting = Setting(key="ai", value=merged)
            session.add(setting)

        await session.commit()
        return merged
