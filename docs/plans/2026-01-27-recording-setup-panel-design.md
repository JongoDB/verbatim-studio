# Recording Setup Panel Design (#32 + #29)

## Summary

Add a pre-recording setup panel with quality presets and optional metadata fields. Appears between clicking "Record Audio" and starting the recorder.

## Flow

1. Click "Record Audio" → show Recording Setup Panel (not AudioRecorder)
2. Panel shows quality selector (always visible) + collapsible "Recording Details (Optional)" section
3. Click "Start Recording" → AudioRecorder launches with chosen quality settings
4. After recording stops, metadata sent with upload

## Quality Presets (#29)

| Preset | Bitrate | Use Case | Est. Size/Min |
|--------|---------|----------|---------------|
| Low | 64 kbps | Meetings, drafts | ~0.5 MB/min |
| Medium (default) | 128 kbps | General use | ~1 MB/min |
| High | 192 kbps | Interviews | ~1.4 MB/min |
| Lossless | 320 kbps | Archival, legal | ~2.4 MB/min |

- Passed to `MediaRecorder` via `audioBitsPerSecond` option
- Persisted in `localStorage` key `verbatim-recording-quality`
- Compact radio-card group: single row desktop, 2x2 mobile

## Metadata Fields (#32)

Collapsible section, collapsed by default:

- **Title** — text input, pre-filled: `Recording - MM/DD/YYYY HH:MM AM/PM`
- **Description** — textarea, 2 rows
- **Tags** — chip input (type + Enter to add, X to remove)
- **Participants** — chip input, same pattern
- **Location / Context** — text input
- **Recorded Date** — datetime input, pre-filled with now

## Data Storage

- `title` → Recording.title column (existing)
- `description`, `participants`, `location`, `recorded_date` → Recording.metadata_ JSON field (existing)
- `tags` → Tag model + recording_tags junction table (existing)

No new columns or migrations needed.

## Upload Endpoint Changes

Add optional form fields alongside file: `description`, `tags` (comma-separated), `participants` (comma-separated), `location`, `recorded_date`. Server packs into `metadata_` JSON and resolves tags to Tag records.

## Files Changed

| File | Change |
|------|--------|
| `packages/frontend/src/components/recordings/AudioRecorder.tsx` | Accept `audioBitsPerSecond` prop, pass to MediaRecorder |
| `packages/frontend/src/components/recordings/RecordingSetupPanel.tsx` | New component: quality selector + metadata form + Start Recording button |
| `packages/frontend/src/pages/recordings/RecordingsPage.tsx` | Insert setup panel into flow between button click and recorder |
| `packages/frontend/src/lib/api.ts` | Expand upload method to send metadata form fields |
| `packages/backend/api/routes/recordings.py` | Accept new form fields, store in metadata_ and tags |
