# Job Queue Improvements (#22)

## Scope

Focused subset of #22: cancel running jobs, retry failed/cancelled jobs, inline progress UI on recording cards. No priority levels or auto-retry backoff.

## Backend

### Cooperative Cancellation

`JobQueue` gains `_cancelled_jobs: set[str]`. The `cancel_job()` method is expanded to accept running jobs (not just queued). For running jobs, the job ID is added to the set. The progress callback checks `job_id in _cancelled_jobs` and raises `JobCancelled`. The handler catches `JobCancelled` separately, setting job status to "cancelled" and recording status to "cancelled".

### Retry

The retry endpoint reads the failed/cancelled job's payload, enqueues a fresh job, and resets the recording status to "pending". The old job remains in DB as history.

### Recording-Level Endpoints

- `POST /api/recordings/{id}/cancel` — finds the active job, cancels it
- `POST /api/recordings/{id}/retry` — finds the last failed/cancelled job, re-enqueues

## Frontend

### RecordingCard Changes

- **Processing**: progress bar + Cancel button
- **Failed**: error message + Retry button
- **Cancelled**: status badge + Retry button

### Polling

Keep existing 5-second recordings list poll. Add per-job progress polling for processing recordings.

## Data Model

No migration needed. Recording status gains "cancelled" as a new string value (column is plain text).

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/services/jobs.py` | Cooperative cancellation, `JobCancelled` exception |
| `packages/backend/api/routes/recordings.py` | Cancel + retry endpoints |
| `packages/backend/api/routes/jobs.py` | Retry endpoint on jobs router |
| `packages/frontend/src/lib/api.ts` | Cancel + retry API methods |
| `packages/frontend/src/components/recordings/RecordingCard.tsx` | Progress bar, cancel/retry buttons |
| `packages/frontend/src/pages/recordings/RecordingsPage.tsx` | Wire up cancel/retry handlers, job progress polling |
