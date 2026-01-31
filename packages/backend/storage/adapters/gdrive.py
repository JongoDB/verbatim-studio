"""Google Drive storage adapter."""

import io
import logging
import mimetypes
from datetime import datetime
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

from services.oauth import refresh_access_token
from storage.base import FileInfo, StorageAdapter
from storage.exceptions import (
    StorageAuthError,
    StorageConnectionError,
    StorageNotFoundError,
)

logger = logging.getLogger(__name__)


class GDriveAdapter(StorageAdapter):
    """Google Drive storage adapter using Drive API v3."""

    # Default app folder name if none specified
    DEFAULT_APP_FOLDER = "Verbatim Studio"

    def __init__(self, config: dict[str, Any]):
        """
        Initialize Google Drive adapter.

        Args:
            config: Configuration with oauth_tokens containing:
                - access_token: OAuth access token
                - refresh_token: OAuth refresh token
                - folder_path: Optional folder name to use as app root
                - folder_id: Optional pre-resolved folder ID
        """
        self.config = config
        self._service = None
        # folder_id is a cached ID of the app's root folder (created on first use)
        self._root_folder_id = config.get("folder_id")
        # folder_path is the name for the app's root folder
        self._folder_path = config.get("folder_path") or self.DEFAULT_APP_FOLDER
        self._root_initialized = False

        # Token info
        tokens = config.get("oauth_tokens", {})
        if isinstance(tokens, str):
            # Tokens may come decrypted as dict or still encrypted as string
            import json

            try:
                tokens = json.loads(tokens)
            except (json.JSONDecodeError, TypeError):
                tokens = {}

        self._access_token = tokens.get("access_token")
        self._refresh_token = tokens.get("refresh_token")
        self._token_expiry = tokens.get("obtained_at")

        if not self._access_token:
            raise StorageAuthError("Missing OAuth tokens for Google Drive")

    def _get_credentials(self) -> Credentials:
        """Get OAuth credentials, refreshing if needed."""
        from google.auth.transport.requests import Request

        creds = Credentials(
            token=self._access_token,
            refresh_token=self._refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=None,  # Will use app credentials
            client_secret=None,
        )

        # Check if we need to refresh
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                self._access_token = creds.token
            except Exception as e:
                logger.error(f"Token refresh failed: {e}")
                raise StorageAuthError("OAuth token expired and refresh failed")

        return creds

    def _get_service(self):
        """Get or create Drive service."""
        if self._service is None:
            creds = self._get_credentials()
            self._service = build("drive", "v3", credentials=creds)
        return self._service

    async def _ensure_root_folder(self) -> str:
        """Ensure the app's root folder exists and return its ID.

        With drive.file scope, we can only access files created by this app.
        This creates the app's root folder if it doesn't exist.
        """
        if self._root_folder_id and self._root_initialized:
            return self._root_folder_id

        service = self._get_service()
        folder_name = self._folder_path

        # Search for existing app folder (created by this app)
        query = (
            f"name = '{folder_name}' and "
            f"mimeType = 'application/vnd.google-apps.folder' and "
            f"trashed = false"
        )
        results = service.files().list(q=query, fields="files(id, name)").execute()
        files = results.get("files", [])

        if files:
            self._root_folder_id = files[0]["id"]
            logger.info(f"Found existing app folder: {folder_name} ({self._root_folder_id})")
        else:
            # Create the app folder
            file_metadata = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
            }
            folder = service.files().create(body=file_metadata, fields="id").execute()
            self._root_folder_id = folder["id"]
            logger.info(f"Created app folder: {folder_name} ({self._root_folder_id})")

        self._root_initialized = True
        return self._root_folder_id

    async def _resolve_folder_path(self, path: str) -> str:
        """Resolve a folder path to a folder ID."""
        root_id = await self._ensure_root_folder()
        if not path or path == "/":
            return root_id

        # Split path and traverse
        parts = [p for p in path.split("/") if p]
        current_id = root_id

        service = self._get_service()

        for part in parts:
            # Search for folder with this name in current folder
            query = (
                f"name = '{part}' and "
                f"'{current_id}' in parents and "
                f"mimeType = 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )

            results = service.files().list(q=query, fields="files(id, name)").execute()

            files = results.get("files", [])
            if not files:
                raise StorageNotFoundError(f"Folder not found: {path}")

            current_id = files[0]["id"]

        return current_id

    async def _resolve_file_path(self, path: str) -> str:
        """Resolve a file path to a file ID."""
        if not path:
            raise StorageNotFoundError("Empty path")

        # Split into folder path and filename
        parts = path.rsplit("/", 1)
        if len(parts) == 1:
            folder_id = await self._ensure_root_folder()
            filename = parts[0]
        else:
            folder_id = await self._resolve_folder_path(parts[0])
            filename = parts[1]

        service = self._get_service()

        # Search for file
        query = f"name = '{filename}' and '{folder_id}' in parents and trashed = false"

        results = service.files().list(q=query, fields="files(id, name)").execute()

        files = results.get("files", [])
        if not files:
            raise StorageNotFoundError(f"File not found: {path}")

        return files[0]["id"]

    async def test_connection(self) -> bool:
        """Test connection to Google Drive."""
        try:
            service = self._get_service()
            # With drive.file scope, we can't access root folder metadata
            # Instead, just verify we can make API calls by listing files
            service.files().list(pageSize=1, fields="files(id)").execute()
            return True
        except Exception as e:
            logger.error(f"Google Drive connection test failed: {e}")
            raise StorageConnectionError(f"Connection failed: {e}")

    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files in a directory."""
        try:
            folder_id = await self._resolve_folder_path(path)
            service = self._get_service()

            query = f"'{folder_id}' in parents and trashed = false"
            fields = "files(id, name, mimeType, size, modifiedTime)"

            results = service.files().list(q=query, fields=fields, pageSize=1000).execute()

            files = []
            for item in results.get("files", []):
                is_dir = item["mimeType"] == "application/vnd.google-apps.folder"
                files.append(
                    FileInfo(
                        name=item["name"],
                        path=f"{path}/{item['name']}" if path else item["name"],
                        size=int(item.get("size", 0)),
                        is_directory=is_dir,
                        modified_at=datetime.fromisoformat(
                            item["modifiedTime"].replace("Z", "+00:00")
                        ),
                        mime_type=None if is_dir else item.get("mimeType"),
                    )
                )

            return files

        except StorageNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            raise StorageConnectionError(f"Failed to list files: {e}")

    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        try:
            file_id = await self._resolve_file_path(path)
            service = self._get_service()

            request = service.files().get_media(fileId=file_id)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)

            done = False
            while not done:
                _, done = downloader.next_chunk()

            return buffer.getvalue()

        except StorageNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Failed to read file: {e}")
            raise StorageConnectionError(f"Failed to read file: {e}")

    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to a file."""
        try:
            # Split path into folder and filename
            parts = path.rsplit("/", 1)
            if len(parts) == 1:
                folder_id = await self._ensure_root_folder()
                filename = parts[0]
            else:
                # Ensure parent folder exists
                await self.ensure_directory(parts[0])
                folder_id = await self._resolve_folder_path(parts[0])
                filename = parts[1]

            service = self._get_service()

            # Check if file exists
            query = f"name = '{filename}' and '{folder_id}' in parents and trashed = false"
            results = service.files().list(q=query, fields="files(id)").execute()
            existing = results.get("files", [])

            # Determine mime type
            mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

            media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime_type, resumable=True)

            if existing:
                # Update existing file
                service.files().update(fileId=existing[0]["id"], media_body=media).execute()
            else:
                # Create new file
                file_metadata = {"name": filename, "parents": [folder_id]}
                service.files().create(
                    body=file_metadata, media_body=media, fields="id"
                ).execute()

        except Exception as e:
            logger.error(f"Failed to write file: {e}")
            raise StorageConnectionError(f"Failed to write file: {e}")

    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        try:
            file_id = await self._resolve_file_path(path)
            service = self._get_service()
            service.files().delete(fileId=file_id).execute()
        except StorageNotFoundError:
            pass  # Already deleted
        except Exception as e:
            logger.error(f"Failed to delete file: {e}")
            raise StorageConnectionError(f"Failed to delete file: {e}")

    async def exists(self, path: str) -> bool:
        """Check if file or directory exists."""
        try:
            await self._resolve_file_path(path)
            return True
        except StorageNotFoundError:
            try:
                await self._resolve_folder_path(path)
                return True
            except StorageNotFoundError:
                return False

    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a file."""
        try:
            file_id = await self._resolve_file_path(path)
            service = self._get_service()

            item = (
                service.files()
                .get(fileId=file_id, fields="id, name, mimeType, size, modifiedTime")
                .execute()
            )

            is_dir = item["mimeType"] == "application/vnd.google-apps.folder"

            return FileInfo(
                name=item["name"],
                path=path,
                size=int(item.get("size", 0)),
                is_directory=is_dir,
                modified_at=datetime.fromisoformat(
                    item["modifiedTime"].replace("Z", "+00:00")
                ),
                mime_type=None if is_dir else item.get("mimeType"),
            )

        except StorageNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Failed to get file info: {e}")
            raise StorageConnectionError(f"Failed to get file info: {e}")

    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist."""
        if not path or path == "/":
            await self._ensure_root_folder()
            return

        root_id = await self._ensure_root_folder()
        parts = [p for p in path.split("/") if p]
        current_id = root_id
        service = self._get_service()

        for part in parts:
            # Check if folder exists
            query = (
                f"name = '{part}' and "
                f"'{current_id}' in parents and "
                f"mimeType = 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )

            results = service.files().list(q=query, fields="files(id)").execute()

            files = results.get("files", [])
            if files:
                current_id = files[0]["id"]
            else:
                # Create folder
                file_metadata = {
                    "name": part,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [current_id],
                }
                folder = (
                    service.files().create(body=file_metadata, fields="id").execute()
                )
                current_id = folder["id"]
