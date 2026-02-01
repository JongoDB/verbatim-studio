# Enterprise Only Features Design

## Overview

This document describes the design for enterprise-only feature gating in Verbatim Studio, including the visual pattern, storage provider changes, and future LLM configuration capabilities.

## Enterprise Only Component Pattern

### EnterpriseBadge Component

A reusable badge with consistent styling:

- **Colors:** Gold/amber background (`bg-amber-100 dark:bg-amber-900/30`) with matching text (`text-amber-700 dark:text-amber-300`)
- **Content:** Lock icon (small, inline) + "Enterprise" text
- **Size:** Same as existing badges (`px-2 py-0.5 text-xs rounded-full`)

### EnterpriseOnlyWrapper Component

A wrapper for any interactive element:

- Reduces opacity (50-60%) on wrapped content
- Disables pointer events / click handlers
- Positions `EnterpriseBadge` consistently (top-right for cards, inline for list items)
- Adds `cursor-not-allowed` styling

### Usage

```tsx
<EnterpriseOnlyWrapper>
  <StorageProviderCard provider="s3" />
</EnterpriseOnlyWrapper>
```

## Storage Provider Changes

**File:** `packages/frontend/src/components/storage/StorageSubtypeSelector.tsx`

Replace `comingSoon: true` with `enterpriseOnly: true` for:

- SMB/Windows Share
- NFS
- S3-Compatible
- Azure Blob
- Google Cloud Storage

Visual change:
- Before: Gray "Coming Soon" badge
- After: Gold/amber "Enterprise" badge with lock icon

Behavior remains the same:
- `opacity-60` on the button
- Click handler blocked
- `cursor-not-allowed` styling

## Future: External LLM Server Configuration (GitHub Issue #TBD)

### Problem Statement

Currently, AI features require downloading and running local LLM models. Enterprise users may want to:

- Use existing self-hosted infrastructure (Ollama, vLLM, LocalAI)
- Leverage cloud APIs they already pay for (OpenAI, Anthropic, Google AI)
- Maintain consistency with their organization's AI governance policies

### Proposed Solution

Add an "AI Provider" configuration section in Settings > AI.

**Supported Provider Types:**

| Type | Examples | Auth Method |
|------|----------|-------------|
| OpenAI-compatible | OpenAI, Azure OpenAI, Ollama, vLLM, LocalAI | API key or none |
| Anthropic | Claude API | API key |
| Google AI | Gemini API | API key |

**UI Elements:**

- Provider type dropdown
- Base URL field (for self-hosted)
- API key field (secure, masked)
- Model selector (fetched from endpoint or manual entry)
- "Test Connection" button
- Separate config sections for: Chat/Completions, Embeddings

### Affected Features

| Feature | Impact | Notes |
|---------|--------|-------|
| Chat Assistant (Max) | Low | Standard chat completions |
| AI Summaries | Low | Text generation |
| Semantic Search | High | Requires embeddings model - changing providers requires full re-index |

### Technical Considerations

- Embeddings dimension mismatch: switching embedding providers invalidates existing vector indexes
- Should warn user and offer to re-index when changing embedding provider
- Store API keys securely (encrypted in settings)
- Graceful fallback if external server is unavailable

**This feature is Enterprise Only.**
