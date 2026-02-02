# LLM Context Documentation Design

**Date**: 2026-02-01
**Issue**: #73 - Add LLM context documentation for user assistance
**Status**: Approved

## Overview

Create comprehensive documentation that enables LLMs to help users with Verbatim Studio navigation, functionality, and troubleshooting.

## Deliverables

### 1. `docs/llm-context.md`
Single comprehensive system prompt (~2500 words) containing:
- Identity/role definition for the LLM
- App overview and key concepts
- Navigation quick reference (all 9 sidebar items + settings)
- Common tasks with step-by-step instructions
- Keyboard shortcuts table
- Settings reference
- Troubleshooting guide (10-15 common issues)
- Response guidelines for the LLM

### 2. `docs/llm-context-bundle.json`
Structured JSON export for external chatbots containing:
- App metadata (name, tagline, description)
- Navigation items with descriptions
- Features with UI locations and steps
- Keyboard shortcuts
- Settings reference
- Troubleshooting entries
- List of knowledge files

### 3. `docs/knowledge/` (17 files)
Modular RAG-optimized documents organized by user task:

```
docs/knowledge/
├── getting-started/
│   ├── overview.md               # What is Verbatim Studio, key concepts
│   ├── first-transcription.md    # Upload → transcribe → view workflow
│   └── navigation.md             # Sidebar items, where to find things
├── transcribing/
│   ├── uploading-files.md        # Supported formats, drag-drop, metadata
│   ├── transcription-settings.md # Model selection, language, diarization
│   ├── editing-transcripts.md    # Segments, speakers, highlights, comments
│   └── exporting.md              # TXT, SRT, VTT, DOCX, PDF formats
├── organizing/
│   ├── projects.md               # Creating, assigning recordings, types
│   ├── tags.md                   # Tagging recordings for filtering
│   ├── documents.md              # Uploading PDFs, OCR, notes
│   └── file-browser.md           # Folder navigation, moving files
├── analyzing/
│   ├── search.md                 # Global search, keyword vs semantic
│   ├── ai-chat.md                # Using the AI assistant, attaching context
│   └── project-analytics.md      # Stats, word frequency, timelines
├── live-transcription/
│   └── real-time.md              # Microphone setup, saving sessions
├── settings/
│   └── configuration.md          # All settings tabs explained
└── troubleshooting/
    ├── common-issues.md          # Model not loading, transcription failed
    └── error-messages.md         # Specific error explanations
```

## Knowledge File Template

Each file follows this structure (200-500 words):

```markdown
# [Task/Topic Title]

## Quick Answer
[2-3 sentence summary for fast answers]

## Step-by-Step
1. Navigate to [location]
2. Click [button/action]
3. ...

## UI Location
- **Page**: [Sidebar item]
- **Section**: [Where on the page]
- **Key buttons**: [Button names]

## Tips
- [Helpful tip 1]
- [Helpful tip 2]

## Related
- [Link to related topic]
```

## Implementation Order

1. Write `docs/llm-context.md` (comprehensive reference)
2. Create `docs/knowledge/` directory structure
3. Write all 17 knowledge base files
4. Generate `docs/llm-context-bundle.json`

## Acceptance Criteria

From issue #73:
- [ ] LLM with context can accurately answer "How do I transcribe an audio file?"
- [ ] LLM can explain all sidebar navigation items
- [ ] LLM understands keyboard shortcuts
- [ ] LLM can troubleshoot common issues (model not loading, transcription failed)
- [ ] Documentation covers 100% of user-facing features

## Out of Scope (This PR)

Per discussion, the following are deferred:
- Enhanced Max with automatic help question detection
- API endpoint for external chatbot support
- Screenshots (textual descriptions sufficient)

## Design Decisions

1. **Audience-first structure**: Knowledge base organized by user tasks rather than technical architecture, since primary use case is helping users navigate the app.

2. **Modular files**: Small (200-500 words) files optimized for RAG retrieval - precise enough for targeted answers, complete enough to be self-contained.

3. **JSON bundle**: Structured export allows external systems to parse without markdown processing and build custom prompts.

4. **Self-contained system prompt**: `llm-context.md` works standalone without needing the knowledge base, suitable for simple chat integrations.
