"""OAuth API endpoints for cloud storage authentication."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.oauth import (
    OAUTH_PROVIDERS,
    cancel_oauth,
    get_oauth_status,
    start_oauth,
)

router = APIRouter(prefix="/api/oauth", tags=["oauth"])


class OAuthStartRequest(BaseModel):
    """Request to start OAuth flow."""

    provider: str


class OAuthStartResponse(BaseModel):
    """Response with auth URL and state."""

    auth_url: str
    state: str
    provider: str


class OAuthStatusResponse(BaseModel):
    """Response with OAuth flow status."""

    status: str  # "pending", "complete", "error"
    provider: str
    error: str | None = None
    tokens: dict | None = None


@router.get("/providers")
async def list_providers() -> dict:
    """List available OAuth providers."""
    return {
        "providers": [
            {"id": provider_id, "name": config["name"]}
            for provider_id, config in OAUTH_PROVIDERS.items()
        ]
    }


@router.post("/start", response_model=OAuthStartResponse)
async def oauth_start(request: OAuthStartRequest) -> OAuthStartResponse:
    """
    Start OAuth flow for a provider.

    Returns auth URL to redirect user to and state for polling.
    """
    if request.provider not in OAUTH_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {request.provider}. "
            f"Available: {list(OAUTH_PROVIDERS.keys())}",
        )

    try:
        auth_url, state = await start_oauth(request.provider)
        return OAuthStartResponse(
            auth_url=auth_url,
            state=state,
            provider=request.provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/status/{state}", response_model=OAuthStatusResponse)
async def oauth_status(state: str) -> OAuthStatusResponse:
    """
    Get status of an OAuth flow.

    Poll this endpoint after starting OAuth to check for completion.
    """
    status = get_oauth_status(state)

    if status is None:
        raise HTTPException(
            status_code=404,
            detail="OAuth session not found or expired",
        )

    return OAuthStatusResponse(
        status=status["status"],
        provider=status["provider"],
        error=status.get("error"),
        tokens=status.get("tokens"),
    )


@router.post("/cancel/{state}")
async def oauth_cancel(state: str) -> dict:
    """
    Cancel an OAuth flow and release the callback server port.

    Call this when the user closes the OAuth dialog without completing.
    """
    cancelled = await cancel_oauth(state)

    if not cancelled:
        raise HTTPException(
            status_code=404,
            detail="OAuth session not found or already completed",
        )

    return {"message": "OAuth flow cancelled", "state": state}
