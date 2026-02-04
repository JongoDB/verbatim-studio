<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" alt="Verbatim Studio Dashboard" width="100%">
</p>

<h1 align="center">
  <img src="docs/screenshots/logo.png" alt="Verbatim Studio Logo" width="120"><br>
  Verbatim Studio
</h1>

<p align="center">
  <strong>Your data. Your device. Your rules.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/tag/JongoDB/verbatim-studio?label=version&color=blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="Platform">
</p>

---

## Why Verbatim Studio?

Organizations handling confidential information—law firms, medical practices, government agencies, research institutions—face a critical challenge: **cloud transcription services require sending sensitive data to third-party servers.**

Verbatim Studio eliminates this risk entirely. All transcription and AI processing happens locally on your machine. Your files never leave your control.

### Built for Compliance

- **HIPAA-ready** — Patient interviews and medical dictation stay on-premises
- **Legal privilege** — Attorney-client communications remain confidential
- **Government security** — Classified briefings never touch external networks
- **Research ethics** — IRB-protected interviews maintain participant privacy

### Built for Everyone

Verbatim Studio works just as well for everyday use:

- **Project managers** documenting meetings and standups
- **Content creators** transcribing interviews and podcasts
- **Students and academics** processing lectures and research
- **Anyone** who wants accurate transcription without privacy trade-offs or subscription fees

---

## Features

### Transcription That Actually Works

- **Whisper-powered accuracy** — The same AI that powers the best cloud services, running locally on your Mac
- **Multi-language support** — Transcribe in 12+ languages with automatic detection
- **Automatic speaker identification** — Know who said what without manual tagging
- **Live transcription** — Real-time speech-to-text from your microphone
- **Video support** — Drop in MP4, MOV, WebM, or MKV files and get transcripts automatically

<p align="center">
  <img src="docs/screenshots/live-transcription.png" alt="Live Transcription" width="80%">
</p>

### Max: Your AI Research Assistant

Max isn't just a chatbot—it's a research tool that actually understands your content:

- **Query across your entire library** — Ask questions that span multiple files and documents
- **Persistent conversations** — Pick up where you left off with saved chat history
- **Document-aware** — Upload PDFs, images, and notes for Max to reference
- **Platform guidance** — Not sure how to do something? Just ask Max

All powered by IBM Granite, running 100% locally. No API keys. No usage limits. No data leaving your machine.

<p align="center">
  <img src="docs/screenshots/ai-assistant.png" alt="Max AI Assistant" width="80%">
</p>

### Professional Editing Tools

- **Clickable timestamps** — Jump to any moment instantly
- **Highlights and bookmarks** — Mark important segments for quick reference
- **In-transcript search** — Find exactly what you're looking for with highlighted navigation
- **Keyboard-first workflow** — Control playback without leaving your keyboard
- **Inline annotations** — Add notes directly to your documents and transcripts

### Find Anything, Instantly

- **Semantic search** — Find content by meaning, not just exact keywords
- **Search everything** — Files, transcripts, documents, notes, and chat history in one place
- **Smart results** — See context snippets so you know exactly what you're clicking into

### Organize Your Way

- **Real folders** — Projects map to actual directories on your filesystem
- **Bulk operations** — Select multiple files and act on them at once
- **Flexible storage** — Keep files local, on network drives, or synced with Google Drive, OneDrive, and Dropbox
- **Full exports** — TXT, SRT, VTT, JSON, or complete backup archives

<p align="center">
  <img src="docs/screenshots/settings.png" alt="Settings" width="80%">
</p>

---

## Installation

### Desktop App

Download for your platform:

| Platform | Download | Status |
|----------|----------|--------|
| **macOS (Apple Silicon)** | [Download .dmg](https://github.com/JongoDB/verbatim-studio/releases) | M1/M2/M3/M4 optimized |
| **macOS (Intel)** | — | Coming soon |
| **Windows** | — | Coming soon |
| **Linux** | — | Coming soon |

The app is self-contained—no Python, Node.js, or other dependencies required. Just download, install, and run.

### First Launch

On first launch, Verbatim Studio will guide you through downloading the AI models you need. Choose what fits your workflow—transcription only, or the full suite with Max and semantic search.

<details>
<summary><strong>macOS: "App is damaged" or "unidentified developer" warning</strong></summary>

The app is not yet code-signed. To open it:

1. **Right-click** (or Control-click) the app and select **Open**
2. Click **Open** in the dialog that appears

Or, if that doesn't work:

1. Open **System Settings** → **Privacy & Security**
2. Scroll down to find the blocked app message
3. Click **Open Anyway**

**Alternative: Download via Terminal to avoid quarantine entirely**

Go to the [Releases page](https://github.com/JongoDB/verbatim-studio/releases), right-click the `.dmg` link, copy the URL, then:

```bash
curl -LO <paste-url-here>
```

Files downloaded via `curl` bypass macOS quarantine, so you won't see security warnings.

</details>

<details>
<summary><strong>Development Setup (Build from Source)</strong></summary>

#### Prerequisites

- Python 3.12+
- Node.js 20+
- pnpm 9+
- ffmpeg 7+

#### Clone and Install

```bash
# Clone the repository
git clone https://github.com/JongoDB/verbatim-studio.git
cd verbatim-studio

# Install Node dependencies
pnpm install

# Set up Python environment
cd packages/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ../..
```

#### Run Development Servers

```bash
# Run both frontend and backend
pnpm dev

# Or run separately
# Terminal 1 - Backend
cd packages/backend && source .venv/bin/activate
python -m uvicorn api.main:app --reload --port 8000

# Terminal 2 - Frontend
cd packages/frontend && pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

</details>

---

## Quick Start

1. **Upload or record** — Drag in audio/video files or start a live transcription
2. **Let the AI work** — Transcription happens locally, typically faster than real-time on Apple Silicon
3. **Review and refine** — Edit speaker names, highlight key moments, add notes
4. **Ask Max** — Query your content, generate summaries, or get help using the platform
5. **Export** — Download as TXT, SRT, VTT, or JSON

---

## Architecture

<pre align="center">
┌─────────────────────────────────────────────────────────────┐
│                     <b>Frontend</b> (React)                        │
│   Dashboard • Recordings • Projects • Documents • Search    │
├─────────────────────────────────────────────────────────────┤
│                     <b>Backend</b> (FastAPI)                       │
│                                                             │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│    │  Database   │  │Transcription│  │     AI      │       │
│    │   Adapter   │  │   Engine    │  │   Service   │       │
│    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
│           │                │                │               │
│       SQLite          WhisperX         llama.cpp           │
│                      MLX Whisper        Granite            │
└─────────────────────────────────────────────────────────────┘
</pre>

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Transcription | WhisperX, MLX Whisper, pyannote.audio |
| AI/LLM | llama-cpp-python, sentence-transformers |
| Audio | WaveSurfer.js, ffmpeg |
| Storage | SQLite, Google Drive, OneDrive, Dropbox |

---

## Roadmap

### Current Release (v0.26.x)

**Core Platform**
- [x] Native macOS desktop app (Apple Silicon optimized)
- [x] Local AI transcription with speaker identification
- [x] Live transcription from microphone
- [x] Video file support with automatic audio extraction

**AI Assistant (Max)**
- [x] Multi-document conversations with chat history
- [x] Semantic search across all content
- [x] Platform guidance and help

**Editing & Organization**
- [x] Clickable timestamps and playback keyboard shortcuts
- [x] Segment highlights and bookmarks
- [x] In-transcript search with navigation
- [x] Inline document annotations
- [x] Project-based organization with real filesystem folders
- [x] Bulk operations

**Storage & Export**
- [x] Local, network, and cloud storage options
- [x] Google Drive, OneDrive, Dropbox integration
- [x] Export to TXT, SRT, VTT, JSON

### In Development

- [ ] Automatic update notifications with release notes
- [ ] External LLM connections (Ollama, OpenAI, self-hosted)
- [ ] Windows and Linux desktop apps
- [ ] macOS Intel support

### Enterprise Tier (Planned)

- [ ] Multi-user with role-based access control
- [ ] Meeting bots for Teams, Google Meet, and Zoom
- [ ] PostgreSQL database support
- [ ] Administration dashboard
- [ ] Audit logging and compliance reports
- [ ] Secure mobile access to self-hosted servers

---

## Configuration

Most settings are available through the **Settings** page in the app.

### AI Models

On first use, Verbatim Studio downloads the AI models you select:

| Model | Size | Purpose |
|-------|------|---------|
| Whisper (base) | ~150 MB | Transcription (configurable up to large-v3) |
| pyannote | ~200 MB | Speaker identification |
| nomic-embed-text | ~550 MB | Semantic search |
| IBM Granite 3.3 | ~5 GB | Max AI assistant (2B lite version also available) |

Models are cached locally and only download once.

<details>
<summary><strong>Environment Variables (Developers)</strong></summary>

Create a `.env` file in `packages/backend/`:

```bash
# Core settings
VERBATIM_MODE=basic
VERBATIM_DATA_DIR=~/.verbatim-studio

# Transcription
VERBATIM_WHISPERX_MODEL=base
VERBATIM_WHISPERX_DEVICE=auto

# OAuth (optional - for cloud storage)
VERBATIM_GOOGLE_CLIENT_ID=your-client-id
VERBATIM_GOOGLE_CLIENT_SECRET=your-secret
```

</details>

---

## Contributing

Contributions are welcome. See the [Development Setup](#development-setup-build-from-source) section to get started.

### Building the Desktop App

```bash
# Build for your current platform
pnpm build:electron

# Build for specific platform
pnpm build:electron:mac
pnpm build:electron:win
pnpm build:electron:linux
```

### Running Tests

```bash
# Backend tests
cd packages/backend && pytest

# Frontend tests
cd packages/frontend && pnpm test

# Type checking
cd packages/frontend && pnpm typecheck
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Verbatim Studio</strong> — Transcription you can trust.
</p>

<p align="center">
  <a href="https://github.com/JongoDB/verbatim-studio/issues">Report Issue</a> •
  <a href="https://github.com/JongoDB/verbatim-studio/discussions">Discussions</a>
</p>
