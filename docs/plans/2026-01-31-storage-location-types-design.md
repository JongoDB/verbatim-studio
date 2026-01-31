# Storage Location Types Design

**Date:** 2026-01-31
**Issue:** #76
**Status:** Draft

## Summary

Extend the storage location system to support multiple storage types beyond local filesystem:
- **Local** - Folders on the local machine
- **Network** - SMB and NFS shares with direct protocol access
- **Cloud** - S3-compatible, Google Drive, OneDrive, Dropbox, Azure Blob, Google Cloud Storage

## Decisions

| Decision | Choice |
|----------|--------|
| Network approach | Direct protocol (app connects with credentials) |
| Cloud providers | All major: S3, GDrive, OneDrive, Dropbox, Azure, GCS |
| Credential storage | Encrypted in SQLite, master key in OS keychain |
| OAuth flow | Local redirect server on localhost |
| Backend architecture | Adapter pattern with abstract interface |
| Connection validation | Test on save + validate on access |

## Storage Types & Configuration

### Type/Subtype Schema

| Type | Subtype | Config Fields |
|------|---------|---------------|
| `local` | - | `path` |
| `network` | `smb` | `server`, `share`, `username`, `password`*, `domain` |
| `network` | `nfs` | `server`, `export_path`, `mount_options` |
| `cloud` | `s3` | `bucket`, `region`, `access_key`, `secret_key`*, `endpoint` |
| `cloud` | `azure` | `container`, `account_name`, `account_key`* |
| `cloud` | `gcs` | `bucket`, `project_id`, `credentials_json`* |
| `cloud` | `gdrive` | `folder_id`, `oauth_tokens`* |
| `cloud` | `onedrive` | `folder_path`, `oauth_tokens`* |
| `cloud` | `dropbox` | `folder_path`, `oauth_tokens`* |

*Fields marked with * are encrypted at rest.

### Database Migration

Add `subtype` column to `storage_locations` table:

```sql
ALTER TABLE storage_locations ADD COLUMN subtype VARCHAR(50);
UPDATE storage_locations SET subtype = NULL WHERE type = 'local';
```

## Backend Architecture

### Storage Adapter Interface

```python
# packages/backend/storage/base.py
from typing import Protocol
from dataclasses import dataclass
from datetime import datetime

@dataclass
class FileInfo:
    name: str
    path: str
    size: int
    is_directory: bool
    modified_at: datetime
    mime_type: str | None = None

class StorageAdapter(Protocol):
    """Abstract interface for all storage backends."""

    async def test_connection(self) -> bool:
        """Verify connectivity and credentials. Raises on failure."""
        ...

    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files and directories at path."""
        ...

    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        ...

    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to file, creating parent directories as needed."""
        ...

    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        ...

    async def exists(self, path: str) -> bool:
        """Check if file or directory exists."""
        ...

    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a single file."""
        ...

    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist."""
        ...
```

### Adapter Implementations

| Adapter | Library | Notes |
|---------|---------|-------|
| `LocalAdapter` | `aiofiles` | Async file I/O |
| `SMBAdapter` | `smbprotocol` | Pure Python SMB2/3 |
| `NFSAdapter` | `libnfs` | Python bindings or subprocess mount |
| `S3Adapter` | `aioboto3` | Works with all S3-compatible services |
| `AzureAdapter` | `azure-storage-blob` | Azure Blob Storage |
| `GCSAdapter` | `google-cloud-storage` | Google Cloud Storage |
| `GDriveAdapter` | `google-api-python-client` | Google Drive API |
| `OneDriveAdapter` | `httpx` | Microsoft Graph API |
| `DropboxAdapter` | `dropbox` | Official Dropbox SDK |

### Factory Function

```python
# packages/backend/storage/factory.py
from persistence.models import StorageLocation
from storage.base import StorageAdapter
from storage.adapters import (
    LocalAdapter, SMBAdapter, NFSAdapter, S3Adapter,
    AzureAdapter, GCSAdapter, GDriveAdapter, OneDriveAdapter, DropboxAdapter
)
from services.encryption import decrypt_config

ADAPTERS = {
    ("local", None): LocalAdapter,
    ("network", "smb"): SMBAdapter,
    ("network", "nfs"): NFSAdapter,
    ("cloud", "s3"): S3Adapter,
    ("cloud", "azure"): AzureAdapter,
    ("cloud", "gcs"): GCSAdapter,
    ("cloud", "gdrive"): GDriveAdapter,
    ("cloud", "onedrive"): OneDriveAdapter,
    ("cloud", "dropbox"): DropboxAdapter,
}

def get_adapter(location: StorageLocation) -> StorageAdapter:
    """Get appropriate adapter for a storage location."""
    adapter_class = ADAPTERS.get((location.type, location.subtype))
    if not adapter_class:
        raise ValueError(f"Unknown storage type: {location.type}/{location.subtype}")

    config = decrypt_config(location.config)
    return adapter_class(config)
```

## Credential Encryption

### Master Key Management

```python
# packages/backend/services/encryption.py
import keyring
import secrets
from cryptography.fernet import Fernet
import base64
import json
import os

SERVICE_NAME = "verbatim-studio"
KEY_NAME = "master-key"
FALLBACK_PATH = os.path.expanduser("~/.verbatim-studio/.keyfile")

def get_master_key() -> bytes:
    """Get or create master encryption key."""
    # Try OS keychain first
    try:
        key = keyring.get_password(SERVICE_NAME, KEY_NAME)
        if key:
            return base64.b64decode(key)
    except Exception:
        pass  # Keyring unavailable

    # Try fallback file
    if os.path.exists(FALLBACK_PATH):
        with open(FALLBACK_PATH, "rb") as f:
            return f.read()

    # Generate new key
    new_key = Fernet.generate_key()

    # Try to store in keychain
    try:
        keyring.set_password(SERVICE_NAME, KEY_NAME, base64.b64encode(new_key).decode())
        return new_key
    except Exception:
        pass

    # Fall back to file
    os.makedirs(os.path.dirname(FALLBACK_PATH), exist_ok=True)
    with open(FALLBACK_PATH, "wb") as f:
        f.write(new_key)
    os.chmod(FALLBACK_PATH, 0o600)
    return new_key

def get_fernet() -> Fernet:
    return Fernet(get_master_key())

SENSITIVE_FIELDS = {
    "password", "secret_key", "account_key", "connection_string",
    "credentials_json", "oauth_tokens", "access_token", "refresh_token"
}

def encrypt_config(config: dict) -> dict:
    """Encrypt sensitive fields in config."""
    fernet = get_fernet()
    result = {}
    for key, value in config.items():
        if key in SENSITIVE_FIELDS and value:
            encrypted = fernet.encrypt(json.dumps(value).encode())
            result[key] = {"_encrypted": base64.b64encode(encrypted).decode()}
        else:
            result[key] = value
    return result

def decrypt_config(config: dict) -> dict:
    """Decrypt sensitive fields in config."""
    fernet = get_fernet()
    result = {}
    for key, value in config.items():
        if isinstance(value, dict) and "_encrypted" in value:
            decrypted = fernet.decrypt(base64.b64decode(value["_encrypted"]))
            result[key] = json.loads(decrypted.decode())
        else:
            result[key] = value
    return result
```

## OAuth Flow

### Supported Providers

| Provider | Auth URL | Scopes |
|----------|----------|--------|
| Google Drive | `accounts.google.com/o/oauth2/v2/auth` | `drive.file` |
| OneDrive | `login.microsoftonline.com/.../oauth2/v2.0/authorize` | `Files.ReadWrite` |
| Dropbox | `www.dropbox.com/oauth2/authorize` | `files.content.write` |

### OAuth Endpoints

```
POST /api/storage-locations/oauth/start
  Body: { "provider": "gdrive" }
  Returns: { "auth_url": "https://...", "state": "abc123" }

GET /api/storage-locations/oauth/status/{state}
  Returns: { "status": "pending" | "complete" | "error", "location_id": "..." }
```

### Callback Server

```python
# packages/backend/services/oauth.py
import asyncio
from aiohttp import web
import secrets
from datetime import datetime, timedelta

# In-memory state store (TTL 5 minutes)
oauth_states: dict[str, dict] = {}

PORTS = [9876, 9877, 9878, 9879]

async def start_oauth(provider: str) -> tuple[str, str]:
    """Start OAuth flow, return (auth_url, state)."""
    state = secrets.token_urlsafe(32)
    oauth_states[state] = {
        "provider": provider,
        "status": "pending",
        "created_at": datetime.utcnow(),
    }

    # Start callback server
    port = await start_callback_server(state)
    redirect_uri = f"http://localhost:{port}/callback"

    # Build auth URL based on provider
    auth_url = build_auth_url(provider, state, redirect_uri)

    return auth_url, state

async def start_callback_server(state: str) -> int:
    """Start temp HTTP server for OAuth callback."""
    app = web.Application()
    app.router.add_get("/callback", lambda r: handle_callback(r, state))

    for port in PORTS:
        try:
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "localhost", port)
            await site.start()

            # Store runner for cleanup
            oauth_states[state]["runner"] = runner
            oauth_states[state]["port"] = port
            return port
        except OSError:
            continue

    raise RuntimeError("No available ports for OAuth callback")

async def handle_callback(request: web.Request, expected_state: str) -> web.Response:
    """Handle OAuth callback from provider."""
    state = request.query.get("state")
    code = request.query.get("code")
    error = request.query.get("error")

    if state != expected_state:
        return web.Response(text="Invalid state", status=400)

    if error:
        oauth_states[state]["status"] = "error"
        oauth_states[state]["error"] = error
        return web.Response(text=f"Authorization failed: {error}")

    # Exchange code for tokens
    provider = oauth_states[state]["provider"]
    tokens = await exchange_code(provider, code, oauth_states[state]["port"])

    # Create storage location with encrypted tokens
    location_id = await create_oauth_location(provider, tokens)

    oauth_states[state]["status"] = "complete"
    oauth_states[state]["location_id"] = location_id

    # Cleanup server after short delay
    asyncio.create_task(cleanup_oauth_server(state))

    return web.Response(
        text="<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>",
        content_type="text/html"
    )

async def cleanup_oauth_server(state: str):
    """Shutdown callback server after delay."""
    await asyncio.sleep(2)
    if state in oauth_states and "runner" in oauth_states[state]:
        await oauth_states[state]["runner"].cleanup()
```

### Token Refresh

```python
# In each OAuth adapter
async def ensure_valid_token(self) -> str:
    """Refresh token if expired, return valid access token."""
    if self.token_expires_at > datetime.utcnow() + timedelta(minutes=5):
        return self.access_token

    # Refresh the token
    new_tokens = await self.refresh_token()

    # Update stored tokens (encrypted)
    await self.update_stored_tokens(new_tokens)

    return new_tokens["access_token"]
```

## Frontend UI

### Component Structure

```
packages/frontend/src/components/storage/
├── StorageLocationModal.tsx      # Main modal container
├── StorageTypeSelector.tsx       # Step 1: Local/Network/Cloud cards
├── StorageSubtypeSelector.tsx    # Step 2: SMB/NFS or cloud provider
├── StorageConfigForm.tsx         # Step 3: Dynamic form fields
├── StorageTestButton.tsx         # Test connection with status
├── StorageLocationCard.tsx       # List item with status indicator
└── OAuthConnectButton.tsx        # "Connect with Google" style button
```

### Add Location Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Add Storage Location                              [X]      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: Choose storage type                                │
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │     📁      │ │     🌐      │ │     ☁️      │           │
│  │   Local     │ │   Network   │ │    Cloud    │           │
│  │  Storage    │ │   Storage   │ │   Storage   │           │
│  │             │ │             │ │             │           │
│  │ Folder on   │ │ SMB or NFS  │ │ S3, Google  │           │
│  │ this device │ │ share       │ │ Drive, etc  │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Type-Specific Forms

**Local:**
```
Name: [____________________]
Path: [____________________] [Browse]
```

**SMB:**
```
Name:     [____________________]
Server:   [____________________]  (e.g., 192.168.1.100)
Share:    [____________________]  (e.g., media)
Username: [____________________]
Password: [____________________]
Domain:   [____________________]  (optional)
```

**S3:**
```
Name:       [____________________]
Bucket:     [____________________]
Region:     [____________________]
Access Key: [____________________]
Secret Key: [____________________]
Endpoint:   [____________________]  (optional, for non-AWS)
```

**OAuth Providers:**
```
Name:   [____________________]
Folder: [____________________]  (optional, default: root)

        [ 🔗 Connect with Google ]
```

### Location List Card

```
┌────────────────────────────────────────────────────────────┐
│ 🟢 My NAS                                    [Edit] [Delete]│
│    SMB · //192.168.1.100/media                             │
│    Default location                                        │
├────────────────────────────────────────────────────────────┤
│ 🟡 Backblaze B2                              [Edit] [Delete]│
│    S3 · verbatim-backups                                   │
│    Last checked: 2 min ago (slow response)                 │
├────────────────────────────────────────────────────────────┤
│ 🔴 Google Drive                        [Reauthorize] [Delete]│
│    OAuth token expired                                     │
└────────────────────────────────────────────────────────────┘
```

## Error Handling

### Connection States

| State | Icon | Meaning |
|-------|------|---------|
| `healthy` | 🟢 | Last access succeeded |
| `degraded` | 🟡 | Slow or intermittent |
| `unreachable` | 🔴 | Connection failed |
| `auth_expired` | 🔴 | OAuth token needs refresh |

### Retry Logic

```python
# In base adapter or decorator
MAX_RETRIES = 3
BACKOFF_SECONDS = [1, 2, 4]

async def with_retry(operation):
    for attempt in range(MAX_RETRIES):
        try:
            return await operation()
        except (ConnectionError, TimeoutError) as e:
            if attempt == MAX_RETRIES - 1:
                raise StorageUnavailableError(str(e))
            await asyncio.sleep(BACKOFF_SECONDS[attempt])
```

### Error Types

```python
class StorageError(Exception):
    """Base storage error."""
    pass

class StorageUnavailableError(StorageError):
    """Storage location is unreachable."""
    pass

class StorageAuthError(StorageError):
    """Authentication failed or expired."""
    pass

class StorageNotFoundError(StorageError):
    """File or directory not found."""
    pass

class StoragePermissionError(StorageError):
    """Permission denied."""
    pass
```

## Background Health Checks

```python
# packages/backend/services/storage_health.py
import asyncio
from datetime import datetime, timedelta

CHECK_INTERVAL = 15 * 60  # 15 minutes

async def health_check_loop():
    """Periodically check non-local storage locations."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL)

        locations = await get_non_local_locations()
        for location in locations:
            try:
                adapter = get_adapter(location)
                await asyncio.wait_for(adapter.test_connection(), timeout=30)
                await update_location_status(location.id, "healthy")
            except asyncio.TimeoutError:
                await update_location_status(location.id, "degraded")
            except StorageAuthError:
                await update_location_status(location.id, "auth_expired")
            except Exception:
                await update_location_status(location.id, "unreachable")
```

## API Endpoints

### New Endpoints

```
POST   /api/storage-locations/test
       Body: { type, subtype, config }
       Returns: { success: bool, error?: string, latency_ms?: number }

POST   /api/storage-locations/oauth/start
       Body: { provider: "gdrive" | "onedrive" | "dropbox" }
       Returns: { auth_url: string, state: string }

GET    /api/storage-locations/oauth/status/{state}
       Returns: { status: "pending" | "complete" | "error", location_id?: string }

POST   /api/storage-locations/{id}/reauthorize
       Returns: { auth_url: string, state: string }
```

### Updated Endpoints

```
POST   /api/storage-locations
       Body: { name, type, subtype, config, is_default }
       (config is encrypted before storage)

PUT    /api/storage-locations/{id}
       Body: { name?, config?, is_default? }
       (config is encrypted before storage)

GET    /api/storage-locations
       Returns: { items: [...], status: { id: "healthy" | "degraded" | ... } }
```

## Dependencies

### New Python Packages

```
# requirements.txt additions
smbprotocol>=1.13.0      # SMB2/3 client
aioboto3>=12.0.0         # Async S3 client
azure-storage-blob>=12.0 # Azure Blob Storage
google-cloud-storage>=2.0 # Google Cloud Storage
google-api-python-client>=2.0 # Google Drive API
dropbox>=11.0            # Dropbox SDK
keyring>=25.0            # OS keychain access
cryptography>=42.0       # Fernet encryption
aiohttp>=3.9             # OAuth callback server
```

### Optional (NFS)

```
libnfs-python>=1.0       # NFS client (may require system lib)
```

## Implementation Phases

### Phase 1: Foundation (Base Infrastructure)
- [ ] Database migration: add `subtype` column
- [ ] Create `storage/base.py` with `StorageAdapter` protocol
- [ ] Create `services/encryption.py` with keyring + Fernet
- [ ] Create `storage/factory.py` with adapter factory
- [ ] Refactor existing code to use `LocalAdapter`
- [ ] Update frontend with type selector UI (local only functional)
- [ ] Add `POST /api/storage-locations/test` endpoint

### Phase 2: Network Storage (SMB/NFS)
- [ ] Implement `SMBAdapter` using `smbprotocol`
- [ ] Implement `NFSAdapter` using `libnfs` or mount
- [ ] Add frontend forms for SMB and NFS
- [ ] Test connection validation for network types

### Phase 3: S3-Compatible Cloud
- [ ] Implement `S3Adapter` using `aioboto3`
- [ ] Add frontend form for S3 configuration
- [ ] Support custom endpoints for B2, Wasabi, MinIO, etc.
- [ ] Test with AWS S3 and Backblaze B2

### Phase 4: OAuth Cloud Providers
- [ ] Implement OAuth callback server
- [ ] Implement `GDriveAdapter` with token refresh
- [ ] Implement `OneDriveAdapter` with Microsoft Graph
- [ ] Implement `DropboxAdapter`
- [ ] Add frontend OAuth connect buttons
- [ ] Add reauthorization flow for expired tokens

### Phase 5: Azure & GCS
- [ ] Implement `AzureAdapter`
- [ ] Implement `GCSAdapter`
- [ ] Add frontend forms for service credentials

### Phase 6: Polish
- [ ] Add background health check loop
- [ ] Add status indicators to location list
- [ ] Handle and display connection errors gracefully
- [ ] Add "Reauthorize" button for OAuth locations
- [ ] Write user documentation for each storage type

## Testing Strategy

### Unit Tests
- Encryption/decryption round-trip
- Config validation for each type
- Adapter factory routing

### Integration Tests
- Local adapter with temp directories
- S3 adapter with LocalStack or MinIO
- OAuth flow with mock provider

### Manual Testing
- Real SMB share on local network
- Real S3 bucket
- Real Google Drive OAuth flow

## Security Considerations

1. **Credentials never logged** - Ensure sensitive fields are masked in logs
2. **HTTPS for OAuth** - All OAuth redirects use HTTPS (except localhost callback)
3. **Token expiry** - Refresh tokens before they expire
4. **Keyring fallback** - Warn users if using file-based key storage
5. **Input validation** - Sanitize paths to prevent directory traversal
