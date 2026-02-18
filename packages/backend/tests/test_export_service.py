"""Tests for export service with speaker stats and AI summary."""

import pytest
from services.export import (
    ExportData,
    ExportSegment,
    ExportService,
    SpeakerStats,
    compute_speaker_stats,
)


@pytest.fixture
def sample_segments():
    return [
        ExportSegment(index=0, start_time=0.0, end_time=5.0, text="Hello how are you today", speaker="S1", speaker_name="Alice"),
        ExportSegment(index=1, start_time=5.0, end_time=8.0, text="I am fine", speaker="S2", speaker_name="Bob"),
        ExportSegment(index=2, start_time=8.0, end_time=15.0, text="Great to hear that from you", speaker="S1", speaker_name="Alice"),
    ]


@pytest.fixture
def speaker_map():
    return {"S1": "Alice", "S2": "Bob"}


@pytest.fixture
def sample_ai_summary():
    return {
        "summary": "A brief conversation between Alice and Bob.",
        "key_points": ["They exchanged greetings", "Bob is fine"],
        "action_items": ["Follow up next week"],
        "topics": ["greeting", "wellbeing"],
        "named_entities": ["Alice", "Bob"],
    }


class TestComputeSpeakerStats:
    def test_basic_stats(self, sample_segments, speaker_map):
        stats = compute_speaker_stats(sample_segments, speaker_map)
        assert len(stats) == 2
        # Sorted by word count descending — Alice has more words
        assert stats[0].speaker_name == "Alice"
        assert stats[0].word_count == 11  # 5 + 6
        assert stats[1].speaker_name == "Bob"
        assert stats[1].word_count == 3

    def test_percentages_sum_to_100(self, sample_segments, speaker_map):
        stats = compute_speaker_stats(sample_segments, speaker_map)
        total_word_pct = sum(s.word_percent for s in stats)
        total_time_pct = sum(s.time_percent for s in stats)
        assert abs(total_word_pct - 100.0) < 0.2
        assert abs(total_time_pct - 100.0) < 0.2

    def test_empty_segments(self, speaker_map):
        stats = compute_speaker_stats([], speaker_map)
        assert stats == []


class TestTxtExport:
    def test_includes_speaker_stats(self, sample_segments, speaker_map, sample_ai_summary):
        data = ExportData(
            title="Test", language="en", model_used="whisper", word_count=13,
            duration_seconds=15.0, segments=sample_segments, speakers=speaker_map,
            speaker_stats=compute_speaker_stats(sample_segments, speaker_map),
            ai_summary=sample_ai_summary,
        )
        result = ExportService().export_txt(data)
        assert "Speaker Statistics" in result
        assert "Alice" in result
        assert "Bob" in result

    def test_includes_ai_summary(self, sample_segments, speaker_map, sample_ai_summary):
        data = ExportData(
            title="Test", language="en", model_used="whisper", word_count=13,
            duration_seconds=15.0, segments=sample_segments, speakers=speaker_map,
            speaker_stats=None, ai_summary=sample_ai_summary,
        )
        result = ExportService().export_txt(data)
        assert "AI Summary" in result
        assert "brief conversation" in result
        assert "Follow up next week" in result

    def test_no_summary_no_section(self, sample_segments, speaker_map):
        data = ExportData(
            title="Test", language="en", model_used=None, word_count=13,
            duration_seconds=15.0, segments=sample_segments, speakers=speaker_map,
        )
        result = ExportService().export_txt(data)
        assert "AI Summary" not in result
        assert "Speaker Statistics" not in result


class TestDocxExport:
    def test_generates_with_stats_and_summary(self, sample_segments, speaker_map, sample_ai_summary):
        data = ExportData(
            title="Test", language="en", model_used="whisper", word_count=13,
            duration_seconds=15.0, segments=sample_segments, speakers=speaker_map,
            speaker_stats=compute_speaker_stats(sample_segments, speaker_map),
            ai_summary=sample_ai_summary,
        )
        result = ExportService().export_docx(data)
        assert isinstance(result, bytes)
        assert len(result) > 0


class TestPdfExport:
    def test_generates_with_stats_and_summary(self, sample_segments, speaker_map, sample_ai_summary):
        pytest.importorskip("reportlab")
        data = ExportData(
            title="Test", language="en", model_used="whisper", word_count=13,
            duration_seconds=15.0, segments=sample_segments, speakers=speaker_map,
            speaker_stats=compute_speaker_stats(sample_segments, speaker_map),
            ai_summary=sample_ai_summary,
        )
        result = ExportService().export_pdf(data)
        assert isinstance(result, bytes)
        assert len(result) > 0
