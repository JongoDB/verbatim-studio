# Verbatim Studio — Feature Matrix

## Features by Tier

| Feature | Basic | Enterprise |
|---------|:-----:|:----------:|
| **Core Transcription** |||
| File upload (audio/video) | ✅ | ✅ |
| WhisperX transcription | ✅ | ✅ |
| WhisperLive (real-time, CUDA) | ✅ | ✅ |
| whisper.cpp (real-time, ARM/CPU) | ✅ | ✅ |
| Speaker diarization | ✅ | ✅ |
| Transcript viewer/editor | ✅ | ✅ |
| Export (DOCX, PDF, SRT, VTT) | ✅ | ✅ |
| **Organization** |||
| Projects & folders | ✅ | ✅ |
| Recording templates | ✅ | ✅ |
| Project templates | ✅ | ✅ |
| Custom metadata fields | ✅ | ✅ |
| **AI Features** |||
| Local Ollama integration | ✅ | ✅ |
| Transcript summarization | ✅ | ✅ |
| AI Chat Assistant | ✅ | ✅ |
| Semantic search | ✅ | ✅ |
| **Enterprise Features** |||
| Multi-user accounts | ❌ | ✅ |
| Role-based access control | ❌ | ✅ |
| User approval workflow | ❌ | ✅ |
| Team workspaces | ❌ | ✅ |
| Meeting bots (Zoom/Teams/Meet) | ❌ | ✅ |
| Audit logging | ❌ | ✅ |
| SSO/SAML integration | ❌ | ✅ |
| Centralized model management | ❌ | ✅ |
| Usage analytics dashboard | ❌ | ✅ |
| Priority job queue | ❌ | ✅ |
| **Access Methods** |||
| Electron desktop app | ✅ | ✅ |
| Browser access | ❌ | ✅ |

## Mode Comparison

| Aspect | Basic Mode | Enterprise Mode |
|--------|------------|-----------------|
| **Target User** | Individual professional | Teams & organizations |
| **Deployment** | Electron app (thick client) | Docker server + Electron/Browser |
| **Database** | SQLite (local) | PostgreSQL |
| **Authentication** | None (implicit single user) | JWT + RBAC |
| **Job Queue** | Threading/synchronous | Celery + Redis |
| **AI Services** | User-managed (local Ollama) | Centrally managed |
| **Updates** | Auto-update from public server | Auto-update from org server |
