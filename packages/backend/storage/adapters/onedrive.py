"""OneDrive storage adapter using Microsoft Graph API."""

import logging
import mimetypes
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

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"


class OneDriveAdapter(StorageAdapter):
    """OneDrive storage adapter using Microsoft Graph API."""

    def __init__(self, config: dict[str, Any]):
        """
        Initialize OneDrive adapter.

        Args:
            config: Configuration with oauth_tokens containing:
                - access_token: OAuth access token
                - refresh_token: OAuth refresh token
                - folder_path: Optional folder path to use as root
        """
        self.config = config
        self._folder_path = config.get("folder_path", "").strip("/")

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
            raise StorageAuthError("Missing OAuth tokens for OneDrive")

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with auth."""
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    def _build_path(self, path: str) -> str:
        """Build full OneDrive path from relative path."""
        if self._folder_path:
            if path:
                return f"{self._folder_path}/{path}"
            return self._folder_path
        return path

    def _get_item_url(self, path: str) -> str:
        """Get Graph API URL for an item by path."""
        full_path = self._build_path(path)
        if not full_path:
            return f"{GRAPH_API_BASE}/me/drive/root"
        # Encode path for URL
        encoded_path = full_path.replace(" ", "%20")
        return f"{GRAPH_API_BASE}/me/drive/root:/{encoded_path}"

    async def _request(
        self,
        method: str,
        url: str,
        **kwargs,
    ) -> httpx.Response:
        """Make authenticated request to Graph API."""
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                headers=self._get_headers(),
                **kwargs,
            )

            if response.status_code == 401:
                # Try to refresh token
                try:
                    new_tokens = await refresh_access_token("onedrive", self._refresh_token)
                    self._access_token = new_tokens["access_token"]
                    # Retry with new token
                    response = await client.request(
                        method,
                        url,
                        headers=self._get_headers(),
                        **kwargs,
                    )
                except Exception as e:
                    raise StorageAuthError(f"Token refresh failed: {e}")

            return response

    async def test_connection(self) -> bool:
        """Test connection to OneDrive."""
        try:
            url = self._get_item_url("")
            response = await self._request("GET", url)

            if response.status_code == 200:
                return True
            elif response.status_code == 404:
                raise StorageNotFoundError(f"Folder not found: {self._folder_path}")
            else:
                raise StorageConnectionError(
                    f"Connection failed: {response.status_code} {response.text}"
                )

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"OneDrive connection test failed: {e}")
            raise StorageConnectionError(f"Connection failed: {e}")

    async def list_files(self, path: str = "") -> list[FileInfo]:
        """List files in a directory."""
        try:
            url = self._get_item_url(path)
            if path or self._folder_path:
                url += ":/children"
            else:
                url += "/children"

            response = await self._request("GET", url)

            if response.status_code == 404:
                raise StorageNotFoundError(f"Folder not found: {path}")

            if response.status_code != 200:
                raise StorageConnectionError(
                    f"Failed to list files: {response.status_code}"
                )

            data = response.json()
            files = []

            for item in data.get("value", []):
                is_dir = "folder" in item
                modified = item.get("lastModifiedDateTime", "")
                if modified:
                    modified_at = datetime.fromisoformat(modified.replace("Z", "+00:00"))
                else:
                    modified_at = datetime.utcnow()

                files.append(
                    FileInfo(
                        name=item["name"],
                        path=f"{path}/{item['name']}" if path else item["name"],
                        size=item.get("size", 0),
                        is_directory=is_dir,
                        modified_at=modified_at,
                        mime_type=item.get("file", {}).get("mimeType"),
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
            url = self._get_item_url(path) + ":/content"

            response = await self._request("GET", url, follow_redirects=True)

            if response.status_code == 404:
                raise StorageNotFoundError(f"File not found: {path}")

            if response.status_code != 200:
                raise StorageConnectionError(
                    f"Failed to read file: {response.status_code}"
                )

            return response.content

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Failed to read file: {e}")
            raise StorageConnectionError(f"Failed to read file: {e}")

    async def write_file(self, path: str, data: bytes) -> None:
        """Write data to a file."""
        try:
            # For small files (< 4MB), use simple upload
            if len(data) < 4 * 1024 * 1024:
                url = self._get_item_url(path) + ":/content"

                async with httpx.AsyncClient() as client:
                    response = await client.put(
                        url,
                        headers={
                            "Authorization": f"Bearer {self._access_token}",
                            "Content-Type": "application/octet-stream",
                        },
                        content=data,
                    )

                    if response.status_code not in (200, 201):
                        raise StorageConnectionError(
                            f"Failed to write file: {response.status_code} {response.text}"
                        )
            else:
                # For large files, use upload session
                await self._upload_large_file(path, data)

        except StorageAuthError:
            raise
        except Exception as e:
            logger.error(f"Failed to write file: {e}")
            raise StorageConnectionError(f"Failed to write file: {e}")

    async def _upload_large_file(self, path: str, data: bytes) -> None:
        """Upload large file using upload session."""
        # Create upload session
        url = self._get_item_url(path) + ":/createUploadSession"

        response = await self._request(
            "POST",
            url,
            json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
        )

        if response.status_code != 200:
            raise StorageConnectionError(f"Failed to create upload session: {response.text}")

        session = response.json()
        upload_url = session["uploadUrl"]

        # Upload in chunks
        chunk_size = 10 * 1024 * 1024  # 10MB chunks
        total_size = len(data)

        async with httpx.AsyncClient() as client:
            for start in range(0, total_size, chunk_size):
                end = min(start + chunk_size, total_size)
                chunk = data[start:end]

                headers = {
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start}-{end - 1}/{total_size}",
                }

                response = await client.put(upload_url, headers=headers, content=chunk)

                if response.status_code not in (200, 201, 202):
                    raise StorageConnectionError(f"Upload failed: {response.text}")

    async def delete_file(self, path: str) -> None:
        """Delete a file."""
        try:
            url = self._get_item_url(path)

            response = await self._request("DELETE", url)

            if response.status_code == 404:
                pass  # Already deleted
            elif response.status_code not in (200, 204):
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
            url = self._get_item_url(path)
            response = await self._request("GET", url)
            return response.status_code == 200
        except Exception:
            return False

    async def get_file_info(self, path: str) -> FileInfo:
        """Get metadata for a file."""
        try:
            url = self._get_item_url(path)
            response = await self._request("GET", url)

            if response.status_code == 404:
                raise StorageNotFoundError(f"File not found: {path}")

            if response.status_code != 200:
                raise StorageConnectionError(
                    f"Failed to get file info: {response.status_code}"
                )

            item = response.json()
            is_dir = "folder" in item
            modified = item.get("lastModifiedDateTime", "")
            if modified:
                modified_at = datetime.fromisoformat(modified.replace("Z", "+00:00"))
            else:
                modified_at = datetime.utcnow()

            return FileInfo(
                name=item["name"],
                path=path,
                size=item.get("size", 0),
                is_directory=is_dir,
                modified_at=modified_at,
                mime_type=item.get("file", {}).get("mimeType"),
            )

        except (StorageNotFoundError, StorageAuthError):
            raise
        except Exception as e:
            logger.error(f"Failed to get file info: {e}")
            raise StorageConnectionError(f"Failed to get file info: {e}")

    async def ensure_directory(self, path: str) -> None:
        """Create directory and parents if they don't exist."""
        if not path:
            return

        # Check if already exists
        if await self.exists(path):
            return

        # Create parent first
        parts = path.rsplit("/", 1)
        if len(parts) == 2:
            await self.ensure_directory(parts[0])
            parent_path = parts[0]
            folder_name = parts[1]
        else:
            parent_path = ""
            folder_name = path

        # Create folder
        parent_url = self._get_item_url(parent_path)
        if parent_path or self._folder_path:
            parent_url += ":/children"
        else:
            parent_url += "/children"

        response = await self._request(
            "POST",
            parent_url,
            json={
                "name": folder_name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "fail",
            },
        )

        if response.status_code not in (200, 201, 409):  # 409 = already exists
            raise StorageConnectionError(
                f"Failed to create folder: {response.status_code} {response.text}"
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

            # Delete contents if requested
            if files and delete_contents:
                for file_info in files:
                    if file_info.is_directory:
                        await self.delete_folder(file_info.path, delete_contents=True)
                    else:
                        await self.delete_file(file_info.path)

            # Delete the folder itself
            url = self._get_item_url(path)
            response = await self._request("DELETE", url)

            if response.status_code in (200, 204, 404):
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

                # Get file ID to move it
                old_path = file_info.path
                filename = file_info.name

                # Determine new parent - folder_path's parent or root
                parts = folder_path.rsplit("/", 1)
                if len(parts) == 2:
                    new_path = f"{parts[0]}/{filename}"
                    new_parent_path = parts[0]
                else:
                    new_path = filename
                    new_parent_path = ""

                # Use Graph API to move the file
                try:
                    # Get the item ID first
                    item_url = self._get_item_url(old_path)
                    item_response = await self._request("GET", item_url)
                    if item_response.status_code != 200:
                        logger.warning(f"Could not get item {old_path}: {item_response.status_code}")
                        continue

                    item_data = item_response.json()
                    item_id = item_data.get("id")
                    if not item_id:
                        continue

                    # Get parent folder ID
                    if new_parent_path:
                        parent_url = self._get_item_url(new_parent_path)
                    else:
                        # Moving to root folder (or app's root if configured)
                        if self._folder_path:
                            parent_url = self._get_item_url("")
                        else:
                            parent_url = f"{GRAPH_API_BASE}/me/drive/root"

                    parent_response = await self._request("GET", parent_url)
                    if parent_response.status_code != 200:
                        logger.warning(f"Could not get parent folder: {parent_response.status_code}")
                        continue

                    parent_data = parent_response.json()
                    parent_id = parent_data.get("id")
                    if not parent_id:
                        continue

                    # Move the item using PATCH
                    move_url = f"{GRAPH_API_BASE}/me/drive/items/{item_id}"
                    move_response = await self._request(
                        "PATCH",
                        move_url,
                        json={"parentReference": {"id": parent_id}},
                    )

                    if move_response.status_code == 200:
                        moved_count += 1
                        logger.debug(f"Moved {old_path} to {new_path}")
                    else:
                        logger.warning(f"Failed to move {old_path}: {move_response.status_code}")

                except Exception as e:
                    logger.warning(f"Failed to move file {old_path}: {e}")

            return moved_count

        except Exception as e:
            logger.error(f"Failed to move files from {folder_path}: {e}")
            raise StorageConnectionError(f"Failed to move files: {e}")
