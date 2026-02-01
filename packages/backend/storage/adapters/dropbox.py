"""Dropbox storage adapter using Dropbox API v2."""

import logging
from datetime import datetime
from typing import Any

import httpx

from services.oauth import refresh_access_token
from storage.base import FileInfo, StorageAdapter
from storage.exceptions import (
    StorageAuthError,
    StorageConnectionError,
    StorageNotFoundError,
)

logger = logging.getLogger(__name__)

DROPBOX_API_BASE = "https://api.dropboxapi.com/2"
DROPBOX_CONTENT_BASE = "https://content.dropboxapi.com/2"


class DropboxAdapter(StorageAdapter):
    """Dropbox storage adapter using Dropbox API v2."""

    DEFAULT_APP_FOLDER = "Verbatim Studio"

    def __init__(self, config: dict[str, Any]):
        """
        Initialize Dropbox adapter.

        Args:
            config: Configuration with oauth_tokens containing:
                - access_token: OAuth access token
                - refresh_token: OAuth refresh token
                - folder_path: Optional folder path to use as root
        """
        self.config = config
        self._folder_path = config.get("folder_path", "").strip("/")
        if not self._folder_path:
            self._folder_path = self.DEFAULT_APP_FOLDER

        # Token info
        tokens = config.get("oauth_tokens", {})
        if isinstance(tokens, str):
            import json

            try:
                tokens = json.loads(tokens)
            except (json.JSONDecodeError, TypeError):
                tokens = {}

        self._access_token = tokens.get("access_token")
        self._refresh_token = tokens.get("refresh_token")

        if not self._access_token:
            raise StorageAuthError("Missing OAuth tokens for Dropbox")

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with auth."""
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    def _build_path(self, path: str) -> str:
        """Build full Dropbox path from relative path.

        Dropbox paths must start with / and be lowercase.
        """
        path = path.strip("/")
        if self._folder_path:
            if path:
                full_path = f"/{self._folder_path}/{path}"
            else:
                full_path = f"/{self._folder_path}"
        else:
            full_path = f"/{path}" if path else ""
        return full_path

    async def _request(
        self,
        method: str,
        url: str,
        retry_auth: bool = True,
        **kwargs,
    ) -> httpx.Response:
        """Make authenticated request to Dropbox API."""
        async with httpx.AsyncClient() as client:
            headers = kwargs.pop("headers", {})
            if "Authorization" not in headers:
                headers["Authorization"] = f"Bearer {self._access_token}"
            if "Content-Type" not in headers:
                headers["Content-Type"] = "application/json"

            response = await client.request(
                method,
                url,
                headers=headers,
                **kwargs,
            )

            if response.status_code == 401 and retry_auth:
                # Try to refresh token
                try:
                    new_tokens = await refresh_access_token("dropbox", self._refresh_token)
                    self._access_token = new_tokens["access_token"]
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    # Retry with new token
                    response = await client.request(
                        method,
                        url,
                        headers=headers,
                        **kwargs,
                    )
                except Exception as e:
                    raise StorageAuthError(f"Token refresh failed: {e}")

            return response

    def _parse_dropbox_error(self, response: httpx.Response) -> str:
        """Parse error message from Dropbox response."""
        try:
            data = response.json()
            if "error_summary" in data:
                return data["error_summary"]
            return response.text
        except Exception:
            return response.text

    async def test_connection(self) -> bool:
        """Test connection to Dropbox."""
        try:
            # Try to get account info
            url = f"{DROPBOX_API_BASE}/users/get_current_account"
            response = await self._request("POST", url)

            if response.status_code == 200:
                # Also verify the app folder exists or can be created
                folder_path = self._build_path("")
                if folder_path:
                    await self.ensure_directory("")
                return True
            else:
                raise StorageConnectionError(
                    f"Connection failed: {response.status_code} {self._parse_dropbox_error(response)}"
                )

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Dropbox connection test failed: {e}")
            raise StorageConnectionError(f"Connection failed: {e}")

    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files in a directory."""
        try:
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_API_BASE}/files/list_folder"

            response = await self._request(
                "POST",
                url,
                json={"path": dropbox_path if dropbox_path else ""},
            )

            if response.status_code == 409:
                # Path not found error
                error = self._parse_dropbox_error(response)
                if "path/not_found" in error:
                    raise StorageNotFoundError(f"Folder not found: {path}")
                raise StorageConnectionError(f"Failed to list files: {error}")

            if response.status_code != 200:
                raise StorageConnectionError(
                    f"Failed to list files: {response.status_code}"
                )

            data = response.json()
            files = []

            for entry in data.get("entries", []):
                is_dir = entry[".tag"] == "folder"
                name = entry["name"]

                if is_dir:
                    modified_at = datetime.utcnow()
                    size = 0
                    mime_type = None
                else:
                    modified = entry.get("server_modified", "")
                    if modified:
                        # Dropbox returns ISO format without timezone
                        modified_at = datetime.fromisoformat(modified.replace("Z", "+00:00"))
                    else:
                        modified_at = datetime.utcnow()
                    size = entry.get("size", 0)
                    mime_type = None  # Dropbox doesn't return MIME type directly

                files.append(
                    FileInfo(
                        name=name,
                        path=f"{path}/{name}" if path else name,
                        size=size,
                        is_directory=is_dir,
                        modified_at=modified_at,
                        mime_type=mime_type,
                    )
                )

            # Handle pagination if needed
            while data.get("has_more"):
                cursor = data["cursor"]
                response = await self._request(
                    "POST",
                    f"{DROPBOX_API_BASE}/files/list_folder/continue",
                    json={"cursor": cursor},
                )
                if response.status_code != 200:
                    break
                data = response.json()
                for entry in data.get("entries", []):
                    is_dir = entry[".tag"] == "folder"
                    name = entry["name"]

                    if is_dir:
                        modified_at = datetime.utcnow()
                        size = 0
                    else:
                        modified = entry.get("server_modified", "")
                        if modified:
                            modified_at = datetime.fromisoformat(modified.replace("Z", "+00:00"))
                        else:
                            modified_at = datetime.utcnow()
                        size = entry.get("size", 0)

                    files.append(
                        FileInfo(
                            name=name,
                            path=f"{path}/{name}" if path else name,
                            size=size,
                            is_directory=is_dir,
                            modified_at=modified_at,
                            mime_type=None,
                        )
                    )

            return files

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            raise StorageConnectionError(f"Failed to list files: {e}")

    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        try:
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_CONTENT_BASE}/files/download"

            # Dropbox download requires path in header, not body
            # Content-Type should NOT be set for download endpoint
            import json

            async def do_download():
                async with httpx.AsyncClient() as client:
                    return await client.post(
                        url,
                        headers={
                            "Authorization": f"Bearer {self._access_token}",
                            "Dropbox-API-Arg": json.dumps({"path": dropbox_path}),
                        },
                    )

            response = await do_download()

            # Handle token refresh
            if response.status_code == 401:
                try:
                    new_tokens = await refresh_access_token("dropbox", self._refresh_token)
                    self._access_token = new_tokens["access_token"]
                    response = await do_download()
                except Exception as e:
                    raise StorageAuthError(f"Token refresh failed: {e}")

            if response.status_code == 409:
                error = self._parse_dropbox_error(response)
                if "path/not_found" in error:
                    raise StorageNotFoundError(f"File not found: {path}")
                raise StorageConnectionError(f"Failed to read file: {error}")

            if response.status_code != 200:
                error_detail = self._parse_dropbox_error(response)
                logger.error(f"Dropbox download failed: status={response.status_code}, path={dropbox_path}, error={error_detail}")
                raise StorageConnectionError(
                    f"Failed to read file: {response.status_code} - {error_detail}"
                )

            return response.content

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Failed to read file {path}: {e}")
            raise StorageConnectionError(f"Failed to read file: {e}")

    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to a file."""
        try:
            dropbox_path = self._build_path(path)

            # Ensure parent directory exists
            parent_parts = path.rsplit("/", 1)
            if len(parent_parts) == 2:
                await self.ensure_directory(parent_parts[0])

            # For files up to 150MB, use simple upload
            if len(data) < 150 * 1024 * 1024:
                url = f"{DROPBOX_CONTENT_BASE}/files/upload"

                import json
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        url,
                        headers={
                            "Authorization": f"Bearer {self._access_token}",
                            "Content-Type": "application/octet-stream",
                            "Dropbox-API-Arg": json.dumps({
                                "path": dropbox_path,
                                "mode": "overwrite",
                                "autorename": False,
                            }),
                        },
                        content=data,
                    )

                    if response.status_code not in (200, 201):
                        raise StorageConnectionError(
                            f"Failed to write file: {response.status_code} {self._parse_dropbox_error(response)}"
                        )
            else:
                # For large files, use upload session
                await self._upload_large_file(dropbox_path, data)

        except StorageAuthError:
            raise
        except Exception as e:
            logger.error(f"Failed to write file: {e}")
            raise StorageConnectionError(f"Failed to write file: {e}")

    async def _upload_large_file(self, dropbox_path: str, data: bytes) -> None:
        """Upload large file using upload session."""
        import json

        chunk_size = 8 * 1024 * 1024  # 8MB chunks
        total_size = len(data)

        async with httpx.AsyncClient() as client:
            # Start session
            start_response = await client.post(
                f"{DROPBOX_CONTENT_BASE}/files/upload_session/start",
                headers={
                    "Authorization": f"Bearer {self._access_token}",
                    "Content-Type": "application/octet-stream",
                    "Dropbox-API-Arg": json.dumps({"close": False}),
                },
                content=data[:chunk_size],
            )

            if start_response.status_code != 200:
                raise StorageConnectionError(f"Failed to start upload: {start_response.text}")

            session_id = start_response.json()["session_id"]
            offset = chunk_size

            # Upload chunks
            while offset < total_size:
                end = min(offset + chunk_size, total_size)
                chunk = data[offset:end]
                is_last = end >= total_size

                if is_last:
                    # Finish session
                    finish_response = await client.post(
                        f"{DROPBOX_CONTENT_BASE}/files/upload_session/finish",
                        headers={
                            "Authorization": f"Bearer {self._access_token}",
                            "Content-Type": "application/octet-stream",
                            "Dropbox-API-Arg": json.dumps({
                                "cursor": {"session_id": session_id, "offset": offset},
                                "commit": {
                                    "path": dropbox_path,
                                    "mode": "overwrite",
                                    "autorename": False,
                                },
                            }),
                        },
                        content=chunk,
                    )

                    if finish_response.status_code != 200:
                        raise StorageConnectionError(f"Upload finish failed: {finish_response.text}")
                else:
                    # Append chunk
                    append_response = await client.post(
                        f"{DROPBOX_CONTENT_BASE}/files/upload_session/append_v2",
                        headers={
                            "Authorization": f"Bearer {self._access_token}",
                            "Content-Type": "application/octet-stream",
                            "Dropbox-API-Arg": json.dumps({
                                "cursor": {"session_id": session_id, "offset": offset},
                                "close": False,
                            }),
                        },
                        content=chunk,
                    )

                    if append_response.status_code != 200:
                        raise StorageConnectionError(f"Upload append failed: {append_response.text}")

                offset = end

    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        try:
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_API_BASE}/files/delete_v2"

            response = await self._request(
                "POST",
                url,
                json={"path": dropbox_path},
            )

            if response.status_code == 409:
                error = self._parse_dropbox_error(response)
                if "path_lookup/not_found" in error:
                    pass  # Already deleted
                else:
                    raise StorageConnectionError(f"Failed to delete file: {error}")
            elif response.status_code not in (200, 409):
                raise StorageConnectionError(
                    f"Failed to delete file: {response.status_code}"
                )

        except StorageAuthError:
            raise
        except Exception as e:
            logger.error(f"Failed to delete file: {e}")
            raise StorageConnectionError(f"Failed to delete file: {e}")

    async def exists(self, path: str) -> bool:
        """Check if file or directory exists."""
        try:
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_API_BASE}/files/get_metadata"

            response = await self._request(
                "POST",
                url,
                json={"path": dropbox_path},
            )

            return response.status_code == 200
        except Exception:
            return False

    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a file."""
        try:
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_API_BASE}/files/get_metadata"

            response = await self._request(
                "POST",
                url,
                json={"path": dropbox_path},
            )

            if response.status_code == 409:
                error = self._parse_dropbox_error(response)
                if "path/not_found" in error:
                    raise StorageNotFoundError(f"File not found: {path}")
                raise StorageConnectionError(f"Failed to get file info: {error}")

            if response.status_code != 200:
                raise StorageConnectionError(
                    f"Failed to get file info: {response.status_code}"
                )

            entry = response.json()
            is_dir = entry[".tag"] == "folder"

            if is_dir:
                modified_at = datetime.utcnow()
                size = 0
            else:
                modified = entry.get("server_modified", "")
                if modified:
                    modified_at = datetime.fromisoformat(modified.replace("Z", "+00:00"))
                else:
                    modified_at = datetime.utcnow()
                size = entry.get("size", 0)

            return FileInfo(
                name=entry["name"],
                path=path,
                size=size,
                is_directory=is_dir,
                modified_at=modified_at,
                mime_type=None,
            )

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Failed to get file info: {e}")
            raise StorageConnectionError(f"Failed to get file info: {e}")

    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist."""
        if not path:
            # Ensure app folder exists
            dropbox_path = self._build_path("")
            if dropbox_path:
                await self._create_folder_if_not_exists(dropbox_path)
            return

        dropbox_path = self._build_path(path)
        await self._create_folder_if_not_exists(dropbox_path)

    async def _create_folder_if_not_exists(self, dropbox_path: str) -> None:
        """Create a folder if it doesn't exist (Dropbox creates parents automatically)."""
        url = f"{DROPBOX_API_BASE}/files/create_folder_v2"

        response = await self._request(
            "POST",
            url,
            json={"path": dropbox_path, "autorename": False},
        )

        # 409 with path/conflict means folder already exists - that's fine
        if response.status_code == 409:
            error = self._parse_dropbox_error(response)
            if "path/conflict" not in error:
                raise StorageConnectionError(f"Failed to create folder: {error}")
        elif response.status_code not in (200, 201):
            raise StorageConnectionError(
                f"Failed to create folder: {response.status_code} {self._parse_dropbox_error(response)}"
            )

    async def delete_folder(self, path: str, delete_contents: bool = False) -> bool:
        """Delete a folder.

        Args:
            path: Path to the folder.
            delete_contents: If True, delete folder and all contents.
                           If False, only delete if empty.

        Returns:
            True if folder was deleted, False if not empty and delete_contents=False.
        """
        try:
            # Check if folder exists
            if not await self.exists(path):
                return True  # Already gone

            # Get folder contents
            files = await self.list_files(path)

            if files and not delete_contents:
                logger.info(f"Folder {path} is not empty, skipping delete")
                return False

            # Dropbox delete_v2 deletes folder and contents recursively
            dropbox_path = self._build_path(path)
            url = f"{DROPBOX_API_BASE}/files/delete_v2"

            response = await self._request(
                "POST",
                url,
                json={"path": dropbox_path},
            )

            if response.status_code in (200, 409):
                return True

            logger.warning(f"Failed to delete folder {path}: {response.status_code}")
            return False

        except StorageNotFoundError:
            return True  # Already deleted
        except Exception as e:
            logger.error(f"Failed to delete folder {path}: {e}")
            raise StorageConnectionError(f"Failed to delete folder: {e}")

    async def move_files_to_parent(self, folder_path: str) -> int:
        """Move all files from a folder to its parent folder.

        Args:
            folder_path: Path to the folder whose contents should be moved.

        Returns:
            Number of files moved.
        """
        try:
            files = await self.list_files(folder_path)
            moved_count = 0

            for file_info in files:
                if file_info.is_directory:
                    continue  # Skip subfolders

                # Determine new path - folder_path's parent
                parts = folder_path.rsplit("/", 1)
                if len(parts) == 2:
                    new_path = f"{parts[0]}/{file_info.name}"
                else:
                    new_path = file_info.name

                # Move the file
                try:
                    old_dropbox_path = self._build_path(file_info.path)
                    new_dropbox_path = self._build_path(new_path)

                    url = f"{DROPBOX_API_BASE}/files/move_v2"
                    response = await self._request(
                        "POST",
                        url,
                        json={
                            "from_path": old_dropbox_path,
                            "to_path": new_dropbox_path,
                            "autorename": False,
                        },
                    )

                    if response.status_code == 200:
                        moved_count += 1
                        logger.debug(f"Moved {file_info.path} to {new_path}")
                    else:
                        logger.warning(f"Failed to move {file_info.path}: {response.status_code}")

                except Exception as e:
                    logger.warning(f"Failed to move file {file_info.path}: {e}")

            return moved_count

        except Exception as e:
            logger.error(f"Failed to move files from {folder_path}: {e}")
            raise StorageConnectionError(f"Failed to move files: {e}")
