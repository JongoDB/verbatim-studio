# External AI Providers UI Design

**Date:** 2026-02-01
**Issue:** #82 (placeholder for #10)
**Status:** Approved

## Overview

Add an "External AI Providers" section to Settings → AI tab as a placeholder for enterprise functionality. The section displays configuration UI for external LLM services but is disabled with an enterprise badge.

## Design Decisions

1. **Separate sections** — Keep existing local models section, add new external providers section below
2. **Separate cards per provider** — Each provider type gets its own configuration card
3. **Full form, disabled** — Show all fields grayed out to demonstrate enterprise value
4. **Tailored fields per provider** — Different fields based on provider requirements

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ Large Language Model                        [Ready ✓]  │
│ [Existing local model cards...]                        │
└─────────────────────────────────────────────────────────┘

     ↓ mt-6 spacing

┌─────────────────────────────────────────────────────────┐
│ External AI Providers              [🔒 Enterprise]     │
│ ─────────────────────────────────────────────────────  │
│ Connect to external LLM services instead of running    │
│ models locally.                                        │
│                                                        │
│ [OpenAI-compatible card]                               │
│ [Anthropic card]                                       │
│ [Google AI card]                                       │
│                                                        │
│ ───────────────────────────────────────────────────── │
│ External providers require an Enterprise license.      │
│ Contact sales@verbatim.studio for more information.    │
└─────────────────────────────────────────────────────────┘
```

## Provider Cards

### OpenAI-compatible

- **Description:** Works with OpenAI, Azure OpenAI, Ollama, vLLM, LocalAI, and other compatible APIs.
- **Fields:**
  - Base URL (text input, default: `https://api.openai.com/v1`)
  - API Key (password input, masked)
  - Model (dropdown + manual entry)
  - Test Connection (button)

### Anthropic

- **Description:** Access Claude models directly via the Anthropic API.
- **Fields:**
  - API Key (password input, masked)
  - Model (dropdown: claude-sonnet-4-20250514, claude-opus-4-20250514, claude-3-5-haiku-20241022)
  - Test Connection (button)

### Google AI

- **Description:** Access Gemini models via the Google AI Studio API.
- **Fields:**
  - API Key (password input, masked)
  - Model (dropdown: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash)
  - Test Connection (button)

## Disabled State

The entire section is wrapped in `EnterpriseOnlyWrapper` which applies:
- `opacity-60` — dims everything
- `cursor-not-allowed` — shows blocked cursor on hover
- `pointer-events-none` on children — prevents interaction
- Enterprise badge positioned at top-right of section header

## Implementation

- Location: `packages/frontend/src/pages/settings/SettingsPage.tsx`
- Insert after line ~1172 (after LLM section closing `</div>`)
- Use existing `EnterpriseBadge` and `EnterpriseOnlyWrapper` from `@/components/ui/EnterpriseBadge`
- No new state or API calls (placeholder only)

## Future Work (Issue #10)

When implementing the full enterprise feature:
- Remove `EnterpriseOnlyWrapper`
- Add state for selected provider, API keys, model selection
- Add API endpoints for saving config and testing connections
- Implement provider abstraction layer in backend
- Handle embeddings dimension mismatch warnings
- Secure API key storage
