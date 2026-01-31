# packages/backend/storage/exceptions.py
"""Storage adapter exceptions."""


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
