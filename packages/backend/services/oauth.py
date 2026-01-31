"""OAuth authentication service for cloud storage providers."""

import asyncio
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from aiohttp import web

from core.config import settings

logger = logging.getLogger(__name__)

# OAuth state storage (in-memory with expiry)
oauth_states: dict[str, dict[str, Any]] = {}

# Callback server ports to try
CALLBACK_PORTS = [9876, 9877, 9878, 9879]

# Provider configurations
OAUTH_PROVIDERS = {
    "gdrive": {
        "name": "Google Drive",
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": ["https://www.googleapis.com/auth/drive.file"],
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
    },
    "onedrive": {
        "name": "OneDrive",
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scopes": ["Files.ReadWrite", "offline_access"],
        "client_id_env": "MICROSOFT_CLIENT_ID",
        "client_secret_env": "MICROSOFT_CLIENT_SECRET",
    },
    "dropbox": {
        "name": "Dropbox",
        "auth_url": "https://www.dropbox.com/oauth2/authorize",
        "token_url": "https://api.dropbox.com/oauth2/token",
        "scopes": [],  # Dropbox uses token_access_type instead
        "client_id_env": "DROPBOX_CLIENT_ID",
        "client_secret_env": "DROPBOX_CLIENT_SECRET",
    },
}

# Running callback servers
_callback_servers: dict[str, web.AppRunner] = {}


def get_client_credentials(provider: str) -> tuple[str, str]:
    """Get client ID and secret for a provider from environment."""
    config = OAUTH_PROVIDERS.get(provider)
    if not config:
        raise ValueError(f"Unknown OAuth provider: {provider}")

    client_id = getattr(settings, config["client_id_env"], None)
    client_secret = getattr(settings, config["client_secret_env"], None)

    if not client_id or not client_secret:
        raise ValueError(
            f"Missing OAuth credentials for {provider}. "
            f"Set {config['client_id_env']} and {config['client_secret_env']} environment variables."
        )

    return client_id, client_secret


def build_auth_url(provider: str, state: str, redirect_uri: str) -> str:
    """Build the authorization URL for a provider."""
    config = OAUTH_PROVIDERS.get(provider)
    if not config:
        raise ValueError(f"Unknown OAuth provider: {provider}")

    client_id, _ = get_client_credentials(provider)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
        "access_type": "offline",  # For refresh tokens
        "prompt": "consent",  # Always show consent screen for refresh token
    }

    if provider == "gdrive":
        params["scope"] = " ".join(config["scopes"])
    elif provider == "onedrive":
        params["scope"] = " ".join(config["scopes"])
    elif provider == "dropbox":
        params["token_access_type"] = "offline"

    return f"{config['auth_url']}?{urlencode(params)}"


async def exchange_code_for_tokens(
    provider: str, code: str, redirect_uri: str
) -> dict[str, Any]:
    """Exchange authorization code for access and refresh tokens."""
    config = OAUTH_PROVIDERS.get(provider)
    if not config:
        raise ValueError(f"Unknown OAuth provider: {provider}")

    client_id, client_secret = get_client_credentials(provider)

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            config["token_url"],
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.text}")
            raise ValueError(f"Token exchange failed: {response.text}")

        tokens = response.json()

        # Normalize token response
        return {
            "access_token": tokens.get("access_token"),
            "refresh_token": tokens.get("refresh_token"),
            "expires_in": tokens.get("expires_in", 3600),
            "token_type": tokens.get("token_type", "Bearer"),
            "scope": tokens.get("scope", ""),
            "obtained_at": datetime.utcnow().isoformat(),
        }


async def refresh_access_token(provider: str, refresh_token: str) -> dict[str, Any]:
    """Refresh an expired access token."""
    config = OAUTH_PROVIDERS.get(provider)
    if not config:
        raise ValueError(f"Unknown OAuth provider: {provider}")

    client_id, client_secret = get_client_credentials(provider)

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            config["token_url"],
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if response.status_code != 200:
            logger.error(f"Token refresh failed: {response.text}")
            raise ValueError(f"Token refresh failed: {response.text}")

        tokens = response.json()

        return {
            "access_token": tokens.get("access_token"),
            "refresh_token": tokens.get("refresh_token", refresh_token),  # May not be returned
            "expires_in": tokens.get("expires_in", 3600),
            "token_type": tokens.get("token_type", "Bearer"),
            "obtained_at": datetime.utcnow().isoformat(),
        }


async def start_oauth(provider: str) -> tuple[str, str]:
    """
    Start OAuth flow for a provider.

    Returns:
        Tuple of (auth_url, state) - auth_url to redirect user, state for polling
    """
    if provider not in OAUTH_PROVIDERS:
        raise ValueError(f"Unknown OAuth provider: {provider}")

    # Validate credentials exist before starting
    get_client_credentials(provider)

    # Generate unique state
    state = secrets.token_urlsafe(32)

    # Store state info
    oauth_states[state] = {
        "provider": provider,
        "status": "pending",
        "created_at": datetime.utcnow(),
        "port": None,
        "tokens": None,
        "error": None,
    }

    # Start callback server
    port = await _start_callback_server(state)
    oauth_states[state]["port"] = port

    # Build auth URL
    redirect_uri = f"http://localhost:{port}/callback"
    auth_url = build_auth_url(provider, state, redirect_uri)

    logger.info(f"Started OAuth flow for {provider}, state={state[:8]}..., port={port}")

    return auth_url, state


def get_oauth_status(state: str) -> dict[str, Any] | None:
    """Get the status of an OAuth flow."""
    if state not in oauth_states:
        return None

    info = oauth_states[state]
    return {
        "status": info["status"],
        "provider": info["provider"],
        "error": info.get("error"),
        "tokens": info.get("tokens"),  # Only present when complete
    }


async def _start_callback_server(state: str) -> int:
    """Start a temporary HTTP server to receive OAuth callback."""
    app = web.Application()
    app.router.add_get("/callback", lambda r: _handle_callback(r, state))

    runner = web.AppRunner(app)
    await runner.setup()

    for port in CALLBACK_PORTS:
        try:
            site = web.TCPSite(runner, "localhost", port)
            await site.start()
            _callback_servers[state] = runner
            logger.info(f"OAuth callback server started on port {port}")
            return port
        except OSError:
            continue

    await runner.cleanup()
    raise RuntimeError("No available ports for OAuth callback server")


async def _handle_callback(request: web.Request, expected_state: str) -> web.Response:
    """Handle OAuth callback from provider."""
    state = request.query.get("state")
    code = request.query.get("code")
    error = request.query.get("error")
    error_description = request.query.get("error_description", "")

    # Validate state
    if state != expected_state:
        return web.Response(
            text="Invalid state parameter",
            status=400,
            content_type="text/html",
        )

    if state not in oauth_states:
        return web.Response(
            text="OAuth session expired",
            status=400,
            content_type="text/html",
        )

    # Handle error from provider
    if error:
        oauth_states[state]["status"] = "error"
        oauth_states[state]["error"] = error_description or error
        await _cleanup_callback_server(state)
        return web.Response(
            text=f"""
            <html>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authorization Failed</h1>
                <p>{error_description or error}</p>
                <p>You can close this window.</p>
            </body>
            </html>
            """,
            content_type="text/html",
        )

    # Exchange code for tokens
    try:
        provider = oauth_states[state]["provider"]
        port = oauth_states[state]["port"]
        redirect_uri = f"http://localhost:{port}/callback"

        tokens = await exchange_code_for_tokens(provider, code, redirect_uri)

        oauth_states[state]["status"] = "complete"
        oauth_states[state]["tokens"] = tokens

        logger.info(f"OAuth complete for {provider}, state={state[:8]}...")

        # Schedule cleanup
        asyncio.create_task(_delayed_cleanup(state))

        return web.Response(
            text=f"""
            <html>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authorization Successful!</h1>
                <p>You have successfully connected your {OAUTH_PROVIDERS[provider]['name']} account.</p>
                <p>You can close this window and return to Verbatim Studio.</p>
                <script>window.close();</script>
            </body>
            </html>
            """,
            content_type="text/html",
        )

    except Exception as e:
        logger.exception(f"Token exchange failed: {e}")
        oauth_states[state]["status"] = "error"
        oauth_states[state]["error"] = str(e)
        await _cleanup_callback_server(state)
        return web.Response(
            text=f"""
            <html>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authorization Failed</h1>
                <p>{str(e)}</p>
                <p>You can close this window.</p>
            </body>
            </html>
            """,
            content_type="text/html",
        )


async def _cleanup_callback_server(state: str) -> None:
    """Stop and cleanup the callback server for a state."""
    if state in _callback_servers:
        runner = _callback_servers.pop(state)
        await runner.cleanup()
        logger.info(f"Cleaned up callback server for state={state[:8]}...")


async def _delayed_cleanup(state: str, delay: float = 5.0) -> None:
    """Cleanup callback server after a delay."""
    await asyncio.sleep(delay)
    await _cleanup_callback_server(state)


def cleanup_expired_states(max_age_minutes: int = 10) -> None:
    """Remove expired OAuth states."""
    now = datetime.utcnow()
    expired = []

    for state, info in oauth_states.items():
        age = now - info["created_at"]
        if age > timedelta(minutes=max_age_minutes):
            expired.append(state)

    for state in expired:
        oauth_states.pop(state, None)
        # Also cleanup any lingering servers
        if state in _callback_servers:
            asyncio.create_task(_cleanup_callback_server(state))

    if expired:
        logger.info(f"Cleaned up {len(expired)} expired OAuth states")
