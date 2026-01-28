"""Test embedding storage helpers."""

import pytest
import struct
from services.embedding import embedding_to_bytes, bytes_to_embedding


def test_embedding_to_bytes():
    """Test converting embedding list to bytes."""
    embedding = [0.1, 0.2, 0.3]
    result = embedding_to_bytes(embedding)
    assert isinstance(result, bytes)
    assert len(result) == 3 * 4  # 3 floats * 4 bytes each


def test_bytes_to_embedding():
    """Test converting bytes back to embedding list."""
    embedding = [0.1, 0.2, 0.3]
    as_bytes = embedding_to_bytes(embedding)
    result = bytes_to_embedding(as_bytes)
    assert len(result) == 3
    for orig, restored in zip(embedding, result):
        assert abs(orig - restored) < 1e-6


def test_roundtrip_768_dim():
    """Test roundtrip with 768-dimensional embedding."""
    embedding = [float(i) / 1000 for i in range(768)]
    as_bytes = embedding_to_bytes(embedding)
    result = bytes_to_embedding(as_bytes)
    assert len(result) == 768
    for orig, restored in zip(embedding, result):
        assert abs(orig - restored) < 1e-6
