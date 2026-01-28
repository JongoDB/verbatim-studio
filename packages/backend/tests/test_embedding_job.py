"""Test embedding job handler."""

import pytest
from services.jobs import job_queue


def test_embedding_handler_registered():
    """Test that embedding handler is registered."""
    assert "embed" in job_queue._handlers
