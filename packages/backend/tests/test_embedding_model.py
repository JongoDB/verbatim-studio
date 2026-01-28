"""Test SegmentEmbedding model."""

import pytest
from persistence.models import SegmentEmbedding


def test_segment_embedding_model_exists():
    """Test that SegmentEmbedding model is defined."""
    assert hasattr(SegmentEmbedding, "__tablename__")
    assert SegmentEmbedding.__tablename__ == "segment_embeddings"


def test_segment_embedding_has_required_columns():
    """Test that SegmentEmbedding has required columns."""
    columns = {c.name for c in SegmentEmbedding.__table__.columns}
    assert "segment_id" in columns
    assert "embedding" in columns
    assert "model_used" in columns
    assert "created_at" in columns
