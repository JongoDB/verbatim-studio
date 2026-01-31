# Phase 4: OAuth Providers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OAuth authentication for Google Drive and OneDrive storage providers

**Architecture:** Local redirect server for OAuth callback, token storage encrypted in SQLite, automatic token refresh

**Tech Stack:** aiohttp (callback server), google-api-python-client (GDrive), httpx (OneDrive Graph API)

---

## Task 1: Add OAuth Dependencies

**Files:**
- Modify: `packages/backend/pyproject.toml`

**Step 1: Add dependencies**
```toml
# Add to [project] dependencies
"aiohttp>=3.9",
"google-api-python-client>=2.0",
"google-auth-oauthlib>=1.0",
```

**Step 2: Install dependencies**
```bash
cd packages/backend && pip install -e .
```

---

## Task 2: Create OAuth Service Module

**Files:**
- Create: `packages/backend/services/oauth.py`
- Create: `packages/backend/tests/test_oauth.py`

**Implementation:**
- OAuth state management (in-memory dict with expiry)
- Build auth URL for each provider
- Token exchange function
- Start/stop callback server on dynamic port

**Key functions:**
- `start_oauth(provider: str) -> tuple[str, str]` - Returns (auth_url, state)
- `get_oauth_status(state: str) -> dict` - Returns status/tokens
- `exchange_code(provider, code, redirect_uri) -> dict` - Exchange code for tokens

---

## Task 3: Create OAuth API Endpoints

**Files:**
- Create: `packages/backend/api/routes/oauth.py`
- Modify: `packages/backend/api/main.py` (add router)

**Endpoints:**
- `POST /api/oauth/start` - Start OAuth flow, returns auth_url
- `GET /api/oauth/status/{state}` - Poll for completion
- `GET /api/oauth/callback` - Handle provider redirect (internal)

---

## Task 4: Implement GDriveAdapter

**Files:**
- Create: `packages/backend/storage/adapters/gdrive.py`
- Create: `packages/backend/tests/test_storage_gdrive.py`
- Modify: `packages/backend/storage/factory.py` (register adapter)

**Implementation:**
- Use Google Drive API v3
- Implement all StorageAdapter methods
- Token refresh logic
- Map folder_path to folder_id

---

## Task 5: Implement OneDriveAdapter

**Files:**
- Create: `packages/backend/storage/adapters/onedrive.py`
- Create: `packages/backend/tests/test_storage_onedrive.py`
- Modify: `packages/backend/storage/factory.py` (register adapter)

**Implementation:**
- Use Microsoft Graph API
- Implement all StorageAdapter methods
- Token refresh logic
- Support folder paths

---

## Task 6: Add Frontend OAuth Types and API

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Add:**
- `OAuthStartRequest` type
- `OAuthStartResponse` type
- `OAuthStatusResponse` type
- `api.oauth.start()` method
- `api.oauth.status()` method

---

## Task 7: Create OAuthConnectButton Component

**Files:**
- Create: `packages/frontend/src/components/storage/OAuthConnectButton.tsx`

**Implementation:**
- "Connect with Google" / "Connect with Microsoft" buttons
- Opens auth URL in new window
- Polls status endpoint until complete
- Calls onSuccess callback with tokens

---

## Task 8: Update StorageConfigForm for OAuth

**Files:**
- Modify: `packages/frontend/src/components/storage/StorageConfigForm.tsx`

**Changes:**
- For gdrive/onedrive/dropbox subtypes, show OAuthConnectButton
- After successful OAuth, show "Connected" status
- Allow disconnect/reconnect

---

## Task 9: Integration Testing

**Manual testing:**
- Test Google Drive OAuth flow end-to-end
- Test OneDrive OAuth flow end-to-end
- Verify file operations work after auth
- Test token refresh

---

## OAuth Provider Details

### Google Drive
- Client ID: Need to create in Google Cloud Console
- Scopes: `https://www.googleapis.com/auth/drive.file`
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token URL: `https://oauth2.googleapis.com/token`

### OneDrive (Microsoft Graph)
- Client ID: Need to create in Azure Portal
- Scopes: `Files.ReadWrite offline_access`
- Auth URL: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token URL: `https://login.microsoftonline.com/common/oauth2/v2.0/token`

---

## Environment Variables Needed

```bash
# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Microsoft OAuth
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
```
