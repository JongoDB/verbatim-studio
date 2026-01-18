# Verbatim Studio Roadmap

## Overview

Verbatim Studio is a privacy-first transcription platform with two tiers:
- **Basic**: Local-only, embedded services (SQLite, llama.cpp, WhisperX), no user accounts
- **Enterprise**: External services (PostgreSQL, Ollama, Redis), multi-user with RBAC

This roadmap organizes 34 feature issues into logical phases for development.

---

## Phase 0: Foundation (Week 1)

**Goal**: Establish adapter architecture that enables both tiers from a single codebase.

| Issue | Title | Priority |
|-------|-------|----------|
| #1 | Architecture Restructure (Adapter Pattern) | CRITICAL |

**Deliverables**:
- [ ] `IDatabaseAdapter` interface with SQLite implementation
- [ ] `ITranscriptionEngine` interface with WhisperX implementation
- [ ] `IAIService` interface (stub for now)
- [ ] `IAuthProvider` interface with `NoAuthProvider` for basic tier
- [ ] Configuration system to select adapters based on tier
- [ ] Dependency injection setup

**Why First**: Every feature depends on this. Building features before architecture means refactoring everything later.

---

## Phase 1: Basic MVP (Weeks 2-4)

**Goal**: Complete, usable transcription workflow for basic tier.

**User Journey**: Upload audio → Transcribe → Edit → Export

| Issue | Title | Priority |
|-------|-------|----------|
| #8 | Live Recording with Real-time Transcription | High |
| #3 | Export System (TXT, SRT, VTT, DOCX, PDF) | High |
| #24 | Multi-language Transcription | High |
| #19 | Video File Support | Medium |
| #14 | Full-text Search | Medium |
| #33 | Recordings List Filtering | Medium |

**Deliverables**:
- [ ] Record audio directly in browser with live transcription
- [ ] Export transcripts in multiple formats
- [ ] Support for non-English audio
- [ ] Upload and transcribe video files (extract audio)
- [ ] Search across all transcripts
- [ ] Filter recordings by various criteria

**Success Criteria**: A user can record a meeting, get it transcribed, edit speaker names, and export to Word/SRT.

---

## Phase 2: Basic Polish (Weeks 5-7)

**Goal**: Delightful UX that makes daily use enjoyable.

| Issue | Title | Priority |
|-------|-------|----------|
| #2 | WaveSurfer.js Waveform Visualization | High |
| #15 | Keyboard Shortcuts | High |
| #23 | Dark Mode | High |
| #20 | Dashboard with Statistics | Medium |
| #21 | Settings Page | Medium |
| #7 | Project Management (Basic) | Medium |
| #5 | Speaker Statistics Panel | Medium |
| #6 | Bulk Speaker Rename | Medium |
| #4 | Segment Comments and Highlights | Low |
| #29 | Recording Quality Presets | Low |
| #30 | Transcription Configuration Presets | Low |
| #31 | Collapsible Sidebar Navigation | Low |
| #32 | Recording Details Form (Metadata) | Low |

**Deliverables**:
- [ ] Audio waveform with click-to-seek
- [ ] Keyboard shortcuts for playback control
- [ ] Dark/light mode toggle
- [ ] Dashboard showing usage stats
- [ ] Settings for transcription preferences
- [ ] Organize recordings into projects
- [ ] View speaker talk time stats
- [ ] Rename all instances of a speaker at once

**Success Criteria**: Power users can navigate entirely by keyboard; UI feels polished and professional.

---

## Phase 3: Basic Advanced + Desktop (Weeks 8-10)

**Goal**: AI features and desktop app for basic tier.

| Issue | Title | Priority |
|-------|-------|----------|
| #16 | Electron Desktop App (Basic) | High |
| #9 | AI Transcript Analysis (llama.cpp) | High |
| #25 | AI Chat Assistant | Medium |
| #13 | Import/Export Archive (.vbz format) | Medium |
| #34 | External WhisperX Service Configuration | Low |

**Deliverables**:
- [ ] Standalone desktop app with embedded services
- [ ] AI-powered transcript summarization
- [ ] Chat assistant for help and transcript search
- [ ] Backup/restore entire workspace
- [ ] Option to offload transcription to external GPU

**Success Criteria**: User can install desktop app with zero configuration; AI provides useful insights.

---

## Phase 4: Enterprise Foundation (Weeks 11-13)

**Goal**: Multi-user capability with proper persistence.

| Issue | Title | Priority |
|-------|-------|----------|
| #12 | PostgreSQL Adapter | Critical |
| #11 | User Auth and RBAC | Critical |
| #22 | Job Queue Improvements | High |

**Deliverables**:
- [ ] PostgreSQL adapter implementing `IDatabaseAdapter`
- [ ] User registration, login, password reset
- [ ] Role-based access control (Admin, User, Viewer)
- [ ] Celery/Redis job queue for transcription
- [ ] Database migrations system

**Success Criteria**: Multiple users can log in; admins can manage users; transcription jobs are queued properly.

---

## Phase 5: Enterprise Features (Weeks 14-16)

**Goal**: Enterprise-grade admin tools and integrations.

| Issue | Title | Priority |
|-------|-------|----------|
| #10 | AI Services Integration (Ollama/External) | High |
| #26 | Service Health Dashboard | High |
| #27 | Database Management Dashboard | Medium |
| #17 | Electron Client (Enterprise) | Medium |
| #18 | Recording Metadata Templates | Medium |
| #28 | Accounting & Audit Reports | Low |

**Deliverables**:
- [ ] Connect to Ollama, OpenAI, Gemini for AI
- [ ] Admin dashboard for service health
- [ ] Database monitoring and maintenance
- [ ] Thin Electron client connecting to server
- [ ] Custom metadata templates per project type
- [ ] Usage tracking and audit logs

**Success Criteria**: IT admin can deploy, monitor, and maintain enterprise installation.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     Verbatim Studio                          │
├─────────────────────────────────────────────────────────────┤
│                      Frontend (React)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐   │
│  │Dashboard│ │Recorder │ │ Editor  │ │ Admin (Enterprise)│  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                      Backend (FastAPI)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Service Layer                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ IDatabase   │ │ ITranscribe │ │ IAIService  │           │
│  │ Adapter     │ │ Engine      │ │             │           │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘           │
│         │               │               │                   │
│    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐              │
│    │Basic│Ent│    │WhisperX │    │Basic│Ent│              │
│    │SQLite│PG│    │         │    │llama│Olla│              │
│    └─────────┘    └─────────┘    └─────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Issue Labels Reference

- `tier:basic` - Basic tier only
- `tier:enterprise` - Enterprise tier only
- `tier:both` - Both tiers
- `priority:high/medium/low` - Implementation priority
- `phase:1/2/3` - Roadmap phase

---

## Getting Started

After this roadmap is approved:

1. **Phase 0**: Begin with adapter architecture (#1)
2. Create interface files in `packages/backend/core/interfaces/`
3. Implement SQLite adapter first (basic tier)
4. Verify existing functionality still works
5. Move to Phase 1 features

---

## Success Metrics

### Basic Tier MVP
- [ ] Cold start to first transcription < 5 minutes
- [ ] Transcription accuracy matches cloud services
- [ ] Export works for all common formats
- [ ] Works completely offline

### Enterprise Tier
- [ ] Supports 10+ concurrent users
- [ ] Admin can manage users without CLI
- [ ] Audit trail for compliance
- [ ] High availability deployment possible
