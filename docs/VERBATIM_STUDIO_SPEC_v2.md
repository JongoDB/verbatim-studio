# Verbatim Studio — Unified Architecture Specification

**Version:** 2.1  
**Date:** January 2025  
**Purpose:** Define the architecture for Verbatim Studio supporting Basic (local) and Enterprise (server-connected) deployment modes with Electron desktop app and browser-based access.

---

## Implementation Status Legend

Throughout this document, implementation status is marked as:
- ✅ **Implemented** — Feature exists in current codebase
- 🔶 **Partial** — Some aspects implemented, others pending
- ⬜ **Not Started** — Feature not yet implemented

---

## Executive Summary

Verbatim Studio is a self-hosted, offline-capable transcription and meeting-capture platform. This specification defines a **unified architecture** supporting two deployment modes:

| Mode | Target User | Backend | Database | Auth | Access Methods |
|------|-------------|---------|----------|------|----------------|
| **Basic** | Individual users | Embedded (localhost) | SQLite ⬜ | None ⬜ | Electron only |
| **Enterprise** | Teams/Organizations | Remote server ✅ | PostgreSQL ✅ | JWT + RBAC ✅ | Electron + Browser ✅ |

**Key Principles:**
- Single codebase, runtime-configurable modes
- Enterprise-first development (disable features for Basic)
- Unified frontend for Electron and browser access
- Service abstraction via provider pattern with auto-discovery

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Deployment Modes](#deployment-modes)
3. [Service Provider Architecture](#service-provider-architecture)
4. [Feature Tiers](#feature-tiers)
5. [Frontend Strategy (Unified)](#frontend-strategy-unified)
6. [Electron Application](#electron-application)
7. [Electron Distribution Model](#electron-distribution-model)
8. [Enterprise Server](#enterprise-server)
9. [Database Strategy](#database-strategy)
10. [Authentication Strategy](#authentication-strategy)
11. [Configuration Schema](#configuration-schema)
12. [Installation Experience](#installation-experience)
13. [Current Codebase Status](#current-codebase-status)
14. [File Structure](#file-structure)
15. [Implementation Checklist](#implementation-checklist)
16. [Migration Path](#migration-path)

---

## Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VERBATIM STUDIO                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐│
│  │      BASIC MODE             │    │         ENTERPRISE MODE              ││
│  │      (Single User)          │    │         (Teams)                      ││
│  │                             │    │                                      ││
│  │  ┌───────────────────────┐  │    │  ┌────────────────┐ ┌─────────────┐ ││
│  │  │    Electron App       │  │    │  │  Electron App  │ │   Browser   │ ││
│  │  │  ┌─────────────────┐  │  │    │  │  (Thin Client) │ │   Client    │ ││
│  │  │  │    Frontend     │  │  │    │  └───────┬────────┘ └──────┬──────┘ ││
│  │  │  │    (React)      │  │  │    │          │                 │        ││
│  │  │  └────────┬────────┘  │  │    │          │   Same Frontend │        ││
│  │  │           │           │  │    │          └────────┬────────┘        ││
│  │  │  ┌────────▼────────┐  │  │    │                   │                 ││
│  │  │  │ Embedded Backend│  │  │    │          ┌────────▼────────┐        ││
│  │  │  │   (FastAPI)     │  │  │    │          │ Verbatim Server │        ││
│  │  │  │   localhost     │  │  │    │          │   (Remote)      │        ││
│  │  │  └────────┬────────┘  │  │    │          └────────┬────────┘        ││
│  │  │           │           │  │    │                   │                 ││
│  │  │  ┌────────▼────────┐  │  │    │  ┌────────────────▼───────────────┐ ││
│  │  │  │     SQLite      │  │  │    │  │         PostgreSQL             │ ││
│  │  │  └─────────────────┘  │  │    │  │  + Redis + Celery + Services   │ ││
│  │  │                       │  │    │  └────────────────────────────────┘ ││
│  │  │  ┌─────────────────┐  │  │    │                                      ││
│  │  │  │  Local Services │  │  │    │  Services managed by server or      ││
│  │  │  │  • Ollama       │  │  │    │  pointed to by user config          ││
│  │  │  │  • WhisperX     │  │  │    │                                      ││
│  │  │  │  • Pyannote     │  │  │    │                                      ││
│  │  │  └─────────────────┘  │  │    │                                      ││
│  │  └───────────────────────┘  │    └─────────────────────────────────────┘│
│  └─────────────────────────────┘                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Access Methods by Mode

| Mode | Electron App | Browser Access | Use Case |
|------|--------------|----------------|----------|
| **Basic** | ✅ Full app (thick client) | ❌ Not available | Individual user, air-gapped |
| **Enterprise** | ✅ Thin client | ✅ Full access | Team flexibility, IT preference |

---

## Deployment Modes

### Basic Mode

**Target:** Individual users who want local-only transcription without server infrastructure.

**Implementation Status:**
- ⬜ SQLite database support
- ⬜ Auth bypass (single-user mode)
- ⬜ Embedded backend for Electron
- ⬜ Threading-based job processing (no Celery)
- ✅ AI service URL configuration (Ollama, WhisperX)

**Characteristics:**
- All services run locally on user's machine
- No authentication required (implicit single user)
- SQLite database stored in user data directory
- User manages their own AI services (Ollama, WhisperX)
- No network required after initial setup
- Electron app is the only access method

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│              User's Machine                      │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │           Electron App                    │   │
│  │  ┌─────────────────────────────────────┐ │   │
│  │  │         React Frontend              │ │   │
│  │  │         (Renderer Process)          │ │   │
│  │  └──────────────┬──────────────────────┘ │   │
│  │                 │ HTTP (localhost:8000)  │   │
│  │  ┌──────────────▼──────────────────────┐ │   │
│  │  │      FastAPI Backend (subprocess)   │ │   │
│  │  │      • Transcription engine         │ │   │
│  │  │      • File management              │ │   │
│  │  │      • Export generation            │ │   │
│  │  └──────────────┬──────────────────────┘ │   │
│  │                 │                        │   │
│  │  ┌──────────────▼──────────────────────┐ │   │
│  │  │           SQLite                    │ │   │
│  │  │    ~/Verbatim/verbatim.db           │ │   │
│  │  └─────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌─────────────────┐  ┌─────────────────────┐   │
│  │  Ollama         │  │  WhisperX/Pyannote  │   │
│  │  (user-managed) │  │  (embedded or ext)  │   │
│  │  localhost:11434│  │  localhost:8001     │   │
│  └─────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Enterprise Mode

**Target:** Teams and organizations requiring multi-user access, centralized management, and advanced features.

**Implementation Status:**
- ✅ PostgreSQL database
- ✅ JWT authentication with RBAC
- ✅ Celery + Redis job queue
- ✅ Multi-user with roles (admin, user)
- ✅ User approval workflow
- ✅ AI settings management (admin panel)
- 🔶 Meeting bots (architecture defined, not fully implemented)
- ⬜ SSO/SAML integration
- ⬜ Team workspaces (multi-tenant)
- ⬜ Audit logging

**Characteristics:**
- Backend runs on dedicated server infrastructure
- Full authentication with RBAC
- PostgreSQL database with Celery job queue
- Centralized AI service management
- Dual access: Electron thin client OR browser
- Admin-managed service endpoints

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Enterprise Deployment                          │
│                                                                          │
│   ┌─────────────────┐      ┌─────────────────┐                          │
│   │  User Machine A │      │  User Machine B │                          │
│   │                 │      │                 │                          │
│   │ ┌─────────────┐ │      │ ┌─────────────┐ │     ┌─────────────────┐  │
│   │ │  Electron   │ │      │ │   Chrome    │ │     │   User C        │  │
│   │ │  (thin)     │ │      │ │   Browser   │ │     │   Safari        │  │
│   │ └──────┬──────┘ │      │ └──────┬──────┘ │     └────────┬────────┘  │
│   └────────┼────────┘      └────────┼────────┘              │           │
│            │                        │                        │           │
│            └────────────┬───────────┴────────────────────────┘           │
│                         │ HTTPS                                          │
│                         ▼                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Verbatim Server                               │   │
│   │                                                                  │   │
│   │  ┌────────────────────────────────────────────────────────────┐ │   │
│   │  │                    Nginx / Reverse Proxy                   │ │   │
│   │  │  • Static frontend serving (browser access)                │ │   │
│   │  │  • API routing                                             │ │   │
│   │  │  • WebSocket proxy                                         │ │   │
│   │  │  • SSL termination                                         │ │   │
│   │  └─────────────────────────┬──────────────────────────────────┘ │   │
│   │                            │                                     │   │
│   │  ┌─────────────────────────▼──────────────────────────────────┐ │   │
│   │  │              FastAPI Backend Cluster                       │ │   │
│   │  │  • /api/* routes                                           │ │   │
│   │  │  • /ws/* WebSocket connections                             │ │   │
│   │  │  • /api/v1/discover (service discovery)                    │ │   │
│   │  └─────────────────────────┬──────────────────────────────────┘ │   │
│   │                            │                                     │   │
│   │  ┌──────────┬──────────────┼──────────────┬──────────┐         │   │
│   │  │          │              │              │          │         │   │
│   │  ▼          ▼              ▼              ▼          ▼         │   │
│   │ ┌────┐  ┌───────┐  ┌────────────┐  ┌──────────┐  ┌────────┐   │   │
│   │ │ PG │  │ Redis │  │  Celery    │  │  Ollama  │  │WhisperX│   │   │
│   │ │ DB │  │       │  │  Workers   │  │  Cluster │  │ Svc    │   │   │
│   │ └────┘  └───────┘  └────────────┘  └──────────┘  └────────┘   │   │
│   │                                                                  │   │
│   │  ┌────────────────────────────────────────────────────────────┐ │   │
│   │  │              Meeting Bots Service                          │ │   │
│   │  │  • Zoom Bot (Meeting SDK)                                  │ │   │
│   │  │  • Teams Bot (Graph API)                                   │ │   │
│   │  │  • Google Meet Bot (Puppeteer)                             │ │   │
│   │  └────────────────────────────────────────────────────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Service Provider Architecture

**Implementation Status:** ⬜ Not Started

### Design Pattern

All external service interactions go through a **ServiceProvider** abstraction layer. This enables:
- Clean separation between Basic (local) and Enterprise (remote) implementations
- Easy testing via mock providers
- Runtime switching without code changes

### Provider Interface

```typescript
// frontend/src/lib/services/types.ts

export interface ServiceEndpoints {
  api: string;           // Main API endpoint
  websocket?: string;    // WebSocket for real-time updates
  aiGateway?: string;    // AI service routing (Enterprise)
}

export interface ServiceProvider {
  readonly mode: 'basic' | 'enterprise';
  
  // Endpoint resolution
  getEndpoints(): ServiceEndpoints;
  getApiUrl(path: string): string;
  
  // Health checks
  checkHealth(): Promise<HealthStatus>;
  
  // Feature availability
  isFeatureEnabled(feature: FeatureFlag): boolean;
}

export interface HealthStatus {
  api: 'healthy' | 'degraded' | 'down';
  database: 'healthy' | 'degraded' | 'down';
  aiServices: Record<string, 'healthy' | 'unavailable'>;
}

export type FeatureFlag = 
  | 'multiUser'
  | 'meetingBots'
  | 'chatAssistant'
  | 'semanticSearch'
  | 'auditLogging'
  | 'sso'
  | 'teamWorkspaces';
```

### Local Service Provider (Basic Mode)

```typescript
// frontend/src/lib/services/LocalServiceProvider.ts

export class LocalServiceProvider implements ServiceProvider {
  readonly mode = 'basic' as const;
  
  private config: BasicModeConfig;
  
  constructor(config: BasicModeConfig) {
    this.config = config;
  }
  
  getEndpoints(): ServiceEndpoints {
    return {
      api: `http://localhost:${this.config.apiPort || 8000}`,
      // No WebSocket in basic mode (polling instead)
      // No AI gateway (direct service calls)
    };
  }
  
  getApiUrl(path: string): string {
    return `${this.getEndpoints().api}${path}`;
  }
  
  async checkHealth(): Promise<HealthStatus> {
    const apiHealth = await this.checkApiHealth();
    const ollamaHealth = await this.checkOllamaHealth();
    
    return {
      api: apiHealth,
      database: apiHealth, // SQLite is part of API in basic mode
      aiServices: {
        ollama: ollamaHealth,
        whisperx: await this.checkWhisperXHealth(),
      }
    };
  }
  
  isFeatureEnabled(feature: FeatureFlag): boolean {
    // Basic mode feature set
    const basicFeatures: FeatureFlag[] = [
      // Core features only, no enterprise features
    ];
    return basicFeatures.includes(feature);
  }
  
  // ... health check implementations
}
```

### Remote Service Provider (Enterprise Mode)

```typescript
// frontend/src/lib/services/RemoteServiceProvider.ts

export class RemoteServiceProvider implements ServiceProvider {
  readonly mode = 'enterprise' as const;
  
  private config: EnterpriseModeConfig;
  private discoveredEndpoints?: ServiceEndpoints;
  private enabledFeatures?: FeatureFlag[];
  
  constructor(config: EnterpriseModeConfig) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    if (this.config.autoDiscover) {
      await this.discoverServices();
    }
  }
  
  private async discoverServices(): Promise<void> {
    const response = await fetch(`${this.config.serverUrl}/api/v1/discover`);
    const discovery: DiscoveryResponse = await response.json();
    
    this.discoveredEndpoints = discovery.services;
    this.enabledFeatures = discovery.features;
  }
  
  getEndpoints(): ServiceEndpoints {
    if (this.discoveredEndpoints) {
      return this.discoveredEndpoints;
    }
    
    // Manual configuration fallback
    return this.config.services || {
      api: this.config.serverUrl,
    };
  }
  
  getApiUrl(path: string): string {
    return `${this.getEndpoints().api}${path}`;
  }
  
  async checkHealth(): Promise<HealthStatus> {
    const response = await fetch(this.getApiUrl('/api/v1/health'));
    return response.json();
  }
  
  isFeatureEnabled(feature: FeatureFlag): boolean {
    return this.enabledFeatures?.includes(feature) ?? false;
  }
}

interface DiscoveryResponse {
  version: string;
  mode: 'enterprise';
  services: ServiceEndpoints;
  features: FeatureFlag[];
  limits: {
    maxUploadSizeMB: number;
    maxConcurrentTranscriptions: number;
  };
}
```

### Service Provider Factory

```typescript
// frontend/src/lib/services/index.ts

let serviceProvider: ServiceProvider | null = null;

export async function initializeServiceProvider(
  config: VerbatimConfig
): Promise<ServiceProvider> {
  if (config.mode === 'basic') {
    serviceProvider = new LocalServiceProvider(config.basic!);
  } else {
    const provider = new RemoteServiceProvider(config.enterprise!);
    await provider.initialize();
    serviceProvider = provider;
  }
  
  return serviceProvider;
}

export function getServiceProvider(): ServiceProvider {
  if (!serviceProvider) {
    throw new Error('ServiceProvider not initialized. Call initializeServiceProvider first.');
  }
  return serviceProvider;
}

// Convenience exports
export const getApiUrl = (path: string) => getServiceProvider().getApiUrl(path);
export const isFeatureEnabled = (f: FeatureFlag) => getServiceProvider().isFeatureEnabled(f);
```

### Backend Service Abstraction

**Implementation Status:** 🔶 Partial — WhisperX and Ollama clients exist but aren't abstracted behind a provider interface.

**Existing Components:**
- ✅ `backend/ai/ollama_client.py` — Ollama API client
- ✅ `backend/engines/whisperx_client.py` — WhisperX integration
- ✅ `backend/core/ai_config.py` — AI configuration management
- ⬜ Service provider abstraction layer

```python
# backend/core/services/base.py (NEW)

from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel

class TranscriptionResult(BaseModel):
    segments: list[dict]
    language: str
    duration: float

class AIServiceProvider(ABC):
    """Abstract base for AI service interactions."""
    
    @abstractmethod
    async def transcribe(
        self, 
        audio_path: str, 
        model: str = "large-v3",
        language: Optional[str] = None
    ) -> TranscriptionResult:
        pass
    
    @abstractmethod
    async def diarize(
        self, 
        audio_path: str,
        num_speakers: Optional[int] = None
    ) -> list[dict]:
        pass
    
    @abstractmethod
    async def generate_summary(
        self, 
        text: str,
        prompt: Optional[str] = None
    ) -> str:
        pass
    
    @abstractmethod
    async def health_check(self) -> dict[str, str]:
        pass


# backend/core/services/local.py (NEW)

class LocalAIServiceProvider(AIServiceProvider):
    """Direct local service calls (Basic mode or embedded Enterprise)."""
    
    def __init__(self, config: Settings):
        self.whisperx_url = config.WHISPERX_SERVICE_URL
        self.ollama_url = config.OLLAMA_URL
        self.use_embedded_whisperx = config.WHISPERX_MODE == "embedded"
    
    async def transcribe(self, audio_path: str, model: str = "large-v3", language: str = None):
        if self.use_embedded_whisperx:
            # Direct Python import (existing WhisperXClient)
            from engines.whisperx_client import WhisperXClient
            client = WhisperXClient(model_name=model)
            return await client.transcribe(audio_path, language)
        else:
            # HTTP call to external WhisperX service
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.whisperx_url}/transcribe",
                    json={"audio_path": audio_path, "model": model, "language": language}
                )
                return TranscriptionResult(**response.json())
```

---

## Feature Tiers

### Feature Matrix

| Feature | Basic | Enterprise | Status | Implementation Notes |
|---------|:-----:|:----------:|:------:|---------------------|
| **Core Transcription** |
| File upload (audio/video) | ✅ | ✅ | ✅ Done | `backend/api/routes/recordings.py` |
| WhisperX transcription | ✅ | ✅ | ✅ Done | `backend/engines/whisperx_client.py` |
| Speaker diarization | ✅ | ✅ | ✅ Done | Pyannote integration |
| Transcript viewer/editor | ✅ | ✅ | ✅ Done | `frontend/src/pages/TranscriptPage.tsx` |
| Export (DOCX, PDF, SRT, VTT) | ✅ | ✅ | ✅ Done | `backend/exports/` |
| **Organization** |
| Projects & folders | ✅ | ✅ | ✅ Done | Full project management |
| Recording templates | ✅ | ✅ | ✅ Done | 7 built-in templates |
| Project templates | ✅ | ✅ | ✅ Done | 6 built-in templates |
| Custom metadata fields | ✅ | ✅ | ✅ Done | Template-driven |
| **AI Features** |
| Local Ollama integration | ✅ | ✅ | ✅ Done | `backend/ai/ollama_client.py` |
| Transcript summarization | ✅ | ✅ | ✅ Done | Via Ollama |
| AI Chat Assistant | ✅ | ✅ | ✅ Done | `backend/ai/chat_agent.py` |
| Semantic search | ✅ | ✅ | ✅ Done | Embeddings + cosine similarity |
| **Enterprise Features** |
| Multi-user accounts | ❌ | ✅ | ✅ Done | JWT + user table |
| Role-based access control | ❌ | ✅ | ✅ Done | Roles: admin, user |
| User approval workflow | ❌ | ✅ | ✅ Done | Admin approves registrations |
| Team workspaces | ❌ | ✅ | ⬜ Not Started | Shared project spaces |
| Meeting bots (Zoom/Teams/Meet) | ❌ | ✅ | 🔶 Partial | Architecture defined in `backend/bots/` |
| Audit logging | ❌ | ✅ | ⬜ Not Started | Action tracking |
| SSO/SAML integration | ❌ | ✅ | ⬜ Not Started | Okta, Azure AD, Google |
| Centralized model management | ❌ | ✅ | ✅ Done | Admin AI settings panel |
| Usage analytics dashboard | ❌ | ✅ | 🔶 Partial | `backend/api/routes/accounting.py` |
| Priority job queue | ❌ | ✅ | ✅ Done | Celery with Redis |
| **Access Methods** |
| Electron desktop app | ✅ | ✅ | ⬜ Not Started | Thick vs. thin client |
| Browser access | ❌ | ✅ | ✅ Done | Nginx serves frontend |

### Feature Flag Implementation

**Implementation Status:** ⬜ Not Started

```typescript
// frontend/src/lib/features.ts

import { getServiceProvider, FeatureFlag } from './services';

// Runtime feature checking
export function useFeature(feature: FeatureFlag): boolean {
  const provider = getServiceProvider();
  return provider.isFeatureEnabled(feature);
}

// React hook for feature-gated UI
export function useFeatureGate(feature: FeatureFlag) {
  const enabled = useFeature(feature);
  
  return {
    enabled,
    // Render helper
    gate: (enabledContent: ReactNode, disabledContent?: ReactNode) => 
      enabled ? enabledContent : (disabledContent ?? null),
  };
}

// Usage in components
function MeetingBotsPage() {
  const { enabled, gate } = useFeatureGate('meetingBots');
  
  return gate(
    <MeetingBotsUI />,
    <UpgradePrompt feature="Meeting Bots" />
  );
}
```

```python
# backend/core/features.py (NEW)

from enum import Enum
from functools import wraps
from fastapi import HTTPException, status

class Feature(str, Enum):
    MULTI_USER = "multiUser"
    MEETING_BOTS = "meetingBots"
    CHAT_ASSISTANT = "chatAssistant"
    SEMANTIC_SEARCH = "semanticSearch"
    AUDIT_LOGGING = "auditLogging"
    SSO = "sso"
    TEAM_WORKSPACES = "teamWorkspaces"

def get_enabled_features() -> list[Feature]:
    """Return features enabled for current deployment mode."""
    from core.config import settings
    
    if settings.DEPLOYMENT_MODE == "basic":
        return []  # No enterprise features
    else:
        # Enterprise: all features (or filtered by license)
        return list(Feature)

def require_feature(feature: Feature):
    """Decorator to gate endpoints by feature flag."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if feature not in get_enabled_features():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Feature '{feature.value}' requires Enterprise mode"
                )
            return await func(*args, **kwargs)
        return wrapper
    return decorator

# Usage
@router.post("/bots/join")
@require_feature(Feature.MEETING_BOTS)
async def join_meeting(request: JoinMeetingRequest):
    ...
```

---

## Frontend Strategy (Unified)

**Implementation Status:** 🔶 Partial — Frontend exists and works in browser, but lacks mode detection and Electron integration.

### Current State
- ✅ React + Vite + TypeScript frontend
- ✅ Tailwind CSS styling
- ✅ React Router for navigation
- ✅ Auth context (`frontend/src/contexts/AuthContext.tsx`)
- ✅ API calls via fetch
- ⬜ Environment detection (Electron vs Browser)
- ⬜ ServiceProvider pattern
- ⬜ Feature gates

### Core Requirement

The frontend must be **identical** for:
1. Electron desktop app (Basic mode - thick client)
2. Electron desktop app (Enterprise mode - thin client)
3. Browser access (Enterprise mode only)

### Environment Detection

```typescript
// frontend/src/lib/environment.ts (NEW)

export type RuntimeEnvironment = 'electron' | 'browser';
export type DeploymentMode = 'basic' | 'enterprise';

export function detectEnvironment(): RuntimeEnvironment {
  // Check for Electron IPC bridge
  if (typeof window !== 'undefined' && window.electronAPI) {
    return 'electron';
  }
  return 'browser';
}

export function getDeploymentMode(): DeploymentMode {
  // Set during app initialization
  return window.__VERBATIM_MODE__ || 'enterprise';
}

// Feature availability based on environment
export function canUseNativeFeature(feature: NativeFeature): boolean {
  return detectEnvironment() === 'electron';
}

export type NativeFeature = 
  | 'nativeFileDialog'
  | 'systemTray'
  | 'globalHotkeys'
  | 'notifications'
  | 'autoUpdate';
```

### Conditional Native Features

```typescript
// frontend/src/lib/electron.ts (NEW)

// Type-safe Electron API wrapper
interface ElectronAPI {
  selectFile: (filters?: FileFilter[]) => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  showNotification: (title: string, body: string) => void;
  getAppVersion: () => Promise<string>;
  getAppPaths: () => Promise<AppPaths>;
  onDeepLink: (callback: (url: string) => void) => void;
  platform: 'darwin' | 'win32' | 'linux';
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __VERBATIM_MODE__?: DeploymentMode;
  }
}

// Safe accessor
export function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}

// Graceful fallbacks
export async function selectFile(filters?: FileFilter[]): Promise<File | string | null> {
  const electron = getElectronAPI();
  
  if (electron) {
    // Native file dialog
    return electron.selectFile(filters);
  } else {
    // Browser file input fallback
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = filters?.map(f => f.extensions.map(e => `.${e}`).join(',')).join(',') || '*';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
  }
}

export function showNotification(title: string, body: string): void {
  const electron = getElectronAPI();
  
  if (electron) {
    electron.showNotification(title, body);
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
```

### API Client Refactoring

**Current State:** Direct fetch calls throughout components

**Target State:** Centralized API client with ServiceProvider integration

```typescript
// frontend/src/lib/apiClient.ts (NEW - replaces scattered fetch calls)

import { getApiUrl } from './services';
import { getElectronAPI } from './electron';

class ApiClient {
  private baseUrl: string = '';
  
  setBaseUrl(url: string) {
    this.baseUrl = url;
  }
  
  private async request<T>(
    method: string,
    path: string,
    options?: RequestOptions
  ): Promise<T> {
    const url = this.baseUrl + path;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options?.headers,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    
    return response.json();
  }
  
  private getAuthHeaders(): Record<string, string> {
    // Integrate with existing AuthContext
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  
  // Typed API methods matching existing backend routes
  recordings = {
    list: () => this.request<Recording[]>('GET', '/api/recordings'),
    get: (id: string) => this.request<Recording>('GET', `/api/recordings/${id}`),
    upload: (file: File | string, metadata?: RecordingMetadata) => 
      this.uploadFile('/api/recordings/upload', file, metadata),
    delete: (id: string) => this.request<void>('DELETE', `/api/recordings/${id}`),
    transcribe: (id: string) => this.request<Job>('POST', `/api/recordings/${id}/transcribe`),
  };
  
  transcripts = {
    get: (id: string) => this.request<Transcript>('GET', `/api/transcripts/${id}`),
    getByRecording: (recordingId: string) => 
      this.request<Transcript>('GET', `/api/transcripts/by-recording/${recordingId}`),
    updateSegment: (transcriptId: string, segmentId: string, data: SegmentUpdate) =>
      this.request<Segment>('PATCH', `/api/transcripts/${transcriptId}/segments/${segmentId}`, { body: data }),
    export: (id: string, format: ExportFormat) =>
      this.downloadFile(`/api/transcripts/${id}/export/${format}`),
  };
  
  projects = {
    list: () => this.request<Project[]>('GET', '/api/projects'),
    get: (id: string) => this.request<Project>('GET', `/api/projects/${id}`),
    create: (data: CreateProject) => this.request<Project>('POST', '/api/projects', { body: data }),
    update: (id: string, data: UpdateProject) => 
      this.request<Project>('PUT', `/api/projects/${id}`, { body: data }),
    delete: (id: string) => this.request<void>('DELETE', `/api/projects/${id}`),
  };
  
  ai = {
    summarize: (transcriptId: string, type: 'short' | 'long' | 'bullets') =>
      this.request<Summary>('POST', `/api/ai/transcripts/${transcriptId}/summarize`, { body: { summary_type: type } }),
    extractActions: (transcriptId: string) =>
      this.request<ActionItems>('POST', `/api/ai/transcripts/${transcriptId}/action-items`),
    semanticSearch: (query: string, transcriptId?: string) =>
      this.request<SearchResults>('POST', '/api/ai/semantic-search', { body: { query, transcript_id: transcriptId } }),
  };
  
  // ... other endpoints
}

export const api = new ApiClient();
```

### Build Configuration

```typescript
// frontend/vite.config.ts (MODIFY existing)

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  
  base: mode === 'electron' ? './' : '/',
  
  build: {
    outDir: mode === 'electron' ? '../electron/renderer' : 'dist',
    // Ensure assets work with file:// protocol in Electron
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@tanstack/react-query', 'zustand'],
        }
      }
    }
  },
  
  define: {
    // Build-time constants
    __BUILD_MODE__: JSON.stringify(mode),
  },
}));
```

---

## Electron Application

**Implementation Status:** ⬜ Not Started

### Main Process Structure

```
electron/
├── src/
│   ├── main/
│   │   ├── index.ts              # Entry point
│   │   ├── app.ts                # App lifecycle
│   │   ├── windows.ts            # Window management
│   │   ├── ipc.ts                # IPC handlers
│   │   ├── backend.ts            # Backend subprocess (Basic mode)
│   │   ├── config.ts             # Configuration management
│   │   ├── tray.ts               # System tray
│   │   ├── updater.ts            # Auto-updates
│   │   └── services/
│   │       ├── healthCheck.ts    # Service health monitoring
│   │       └── modelManager.ts   # AI model downloads
│   ├── preload/
│   │   └── index.ts              # Context bridge
│   └── renderer/                 # Built frontend (copied during build)
├── resources/
│   ├── backend/                  # Bundled Python backend (Basic mode)
│   ├── icons/
│   └── models/                   # Bundled base models (optional)
├── package.json
├── electron-builder.json
└── tsconfig.json
```

### Main Process Implementation

```typescript
// electron/src/main/index.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { initializeConfig, getConfig } from './config';
import { createMainWindow, createSetupWindow } from './windows';
import { startBackendProcess, stopBackendProcess } from './backend';
import { registerIpcHandlers } from './ipc';
import { initializeTray } from './tray';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

async function bootstrap() {
  // Load or initialize configuration
  const config = await initializeConfig();
  
  // Register IPC handlers before creating windows
  registerIpcHandlers();
  
  if (config.needsSetup) {
    // First run - show setup wizard
    createSetupWindow();
  } else {
    await launchApp(config);
  }
}

async function launchApp(config: VerbatimConfig) {
  if (config.mode === 'basic') {
    // Basic mode: Start embedded backend
    await startBackendProcess(config.basic!);
  }
  
  // Create main window
  const mainWindow = createMainWindow(config);
  
  // Initialize system tray
  initializeTray(mainWindow);
  
  // Set up auto-updater (if enabled)
  if (config.autoUpdate) {
    const { initializeUpdater } = await import('./updater');
    initializeUpdater(mainWindow);
  }
}

// App lifecycle
app.on('ready', bootstrap);

app.on('activate', () => {
  // macOS: re-create window when dock icon clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = getConfig();
    if (config && !config.needsSetup) {
      createMainWindow(config);
    }
  }
});

app.on('before-quit', async () => {
  // Graceful shutdown
  await stopBackendProcess();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle deep links (verbatim://...)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
```

### Window Management

```typescript
// electron/src/main/windows.ts

import { BrowserWindow, shell } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;

export function createMainWindow(config: VerbatimConfig): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Verbatim Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
      // Security
      sandbox: true,
    },
    // Platform-specific
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    show: false, // Show after ready-to-show
  });
  
  // Determine what URL to load
  const frontendUrl = getFrontendUrl(config);
  mainWindow.loadURL(frontendUrl);
  
  // Inject deployment mode
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      window.__VERBATIM_MODE__ = '${config.mode}';
    `);
  });
  
  // Show when ready (prevents white flash)
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });
  
  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  return mainWindow;
}

function getFrontendUrl(config: VerbatimConfig): string {
  if (!app.isPackaged) {
    // Development: Vite dev server
    return 'http://localhost:5173';
  }
  
  if (config.mode === 'enterprise') {
    // Enterprise: Load from server (enables SSR, shared state)
    return `${config.enterprise!.serverUrl}`;
  }
  
  // Basic mode: Load bundled frontend
  return `file://${path.join(__dirname, '../renderer/index.html')}`;
}

export function createSetupWindow(): BrowserWindow {
  setupWindow = new BrowserWindow({
    width: 700,
    height: 600,
    resizable: false,
    title: 'Verbatim Studio Setup',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  
  // Always load bundled setup (even for Enterprise initial config)
  const setupUrl = app.isPackaged
    ? `file://${path.join(__dirname, '../renderer/index.html')}#/setup`
    : 'http://localhost:5173/#/setup';
  
  setupWindow.loadURL(setupUrl);
  
  return setupWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
```

### Backend Process Management (Basic Mode)

```typescript
// electron/src/main/backend.ts

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';

class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private healthCheckInterval: NodeJS.Timer | null = null;
  
  async start(config: BasicModeConfig): Promise<void> {
    if (this.process) {
      console.log('Backend already running');
      return;
    }
    
    const pythonPath = this.getPythonPath();
    const backendPath = this.getBackendPath();
    const env = this.buildEnvironment(config);
    
    console.log(`Starting backend: ${pythonPath} ${backendPath}`);
    
    this.process = spawn(pythonPath, ['-m', 'uvicorn', 'api.main:app', '--port', String(config.apiPort || 8000)], {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    this.process.stdout?.on('data', (data) => {
      console.log(`[Backend] ${data}`);
      this.emit('log', { level: 'info', message: data.toString() });
    });
    
    this.process.stderr?.on('data', (data) => {
      console.error(`[Backend Error] ${data}`);
      this.emit('log', { level: 'error', message: data.toString() });
    });
    
    this.process.on('exit', (code) => {
      console.log(`Backend exited with code ${code}`);
      this.process = null;
      this.emit('exit', code);
    });
    
    // Wait for backend to be ready
    await this.waitForHealth(config.apiPort || 8000);
    
    // Start health monitoring
    this.startHealthCheck(config.apiPort || 8000);
  }
  
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (!this.process) return;
    
    return new Promise((resolve) => {
      this.process!.on('exit', () => resolve());
      
      // Graceful shutdown
      this.process!.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);
    });
  }
  
  private getPythonPath(): string {
    if (app.isPackaged) {
      // Bundled Python
      const resourcesPath = process.resourcesPath;
      if (process.platform === 'win32') {
        return path.join(resourcesPath, 'backend', 'python', 'python.exe');
      } else {
        return path.join(resourcesPath, 'backend', 'venv', 'bin', 'python');
      }
    } else {
      // Development: Use system Python
      return 'python3';
    }
  }
  
  private getBackendPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'backend');
    } else {
      return path.join(__dirname, '../../../../backend');
    }
  }
  
  private buildEnvironment(config: BasicModeConfig): NodeJS.ProcessEnv {
    const userDataPath = app.getPath('userData');
    
    return {
      ...process.env,
      
      // Deployment mode
      DEPLOYMENT_MODE: 'basic',
      AUTH_REQUIRED: 'false',
      
      // Paths
      DATABASE_URL: `sqlite:///${path.join(userDataPath, 'verbatim.db')}`,
      MEDIA_STORAGE_PATH: path.join(userDataPath, 'media'),
      MODELS_PATH: path.join(userDataPath, 'models'),
      LOG_FILE: path.join(userDataPath, 'logs', 'backend.log'),
      
      // AI Services
      OLLAMA_URL: config.ollamaUrl || 'http://localhost:11434',
      WHISPERX_MODE: config.whisperxMode || 'embedded',
      WHISPERX_SERVICE_URL: config.whisperxUrl || 'http://localhost:8001',
      
      // Disable enterprise features
      CELERY_ENABLED: 'false',
    };
  }
  
  private async waitForHealth(port: number, timeout = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          console.log('Backend is healthy');
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    
    throw new Error('Backend failed to start within timeout');
  }
  
  private startHealthCheck(port: number): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (!response.ok) {
          this.emit('unhealthy');
        }
      } catch {
        this.emit('unhealthy');
      }
    }, 10000);
  }
}

export const backendManager = new BackendManager();

export const startBackendProcess = (config: BasicModeConfig) => backendManager.start(config);
export const stopBackendProcess = () => backendManager.stop();
```

### Preload Script (Context Bridge)

```typescript
// electron/src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  
  // File operations
  selectFile: (filters?: FileFilter[]) => 
    ipcRenderer.invoke('dialog:selectFile', filters),
  selectFolder: () => 
    ipcRenderer.invoke('dialog:selectFolder'),
  saveFile: (defaultPath: string, filters?: FileFilter[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultPath, filters),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getAppPaths: () => ipcRenderer.invoke('app:getPaths'),
  
  // Configuration
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: Partial<VerbatimConfig>) => 
    ipcRenderer.invoke('config:set', config),
  
  // Backend status (Basic mode)
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  onBackendLog: (callback: (log: LogEntry) => void) => {
    const handler = (_: any, log: LogEntry) => callback(log);
    ipcRenderer.on('backend:log', handler);
    return () => ipcRenderer.removeListener('backend:log', handler);
  },
  
  // Notifications
  showNotification: (title: string, body: string) => 
    ipcRenderer.send('notification:show', { title, body }),
  
  // Model management
  downloadModel: (modelName: string) => 
    ipcRenderer.invoke('models:download', modelName),
  cancelModelDownload: (modelName: string) =>
    ipcRenderer.invoke('models:cancelDownload', modelName),
  onModelDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (_: any, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on('models:downloadProgress', handler);
    return () => ipcRenderer.removeListener('models:downloadProgress', handler);
  },
  
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  
  // Deep links
  onDeepLink: (callback: (url: string) => void) => {
    const handler = (_: any, url: string) => callback(url);
    ipcRenderer.on('deepLink', handler);
    return () => ipcRenderer.removeListener('deepLink', handler);
  },
});
```

---

## Electron Distribution Model

**Implementation Status:** ⬜ Not Started (Future Roadmap)

### Overview

Electron desktop apps are distributed through two channels based on deployment mode:

| Mode | Download Source | Configuration | Updates |
|------|-----------------|---------------|---------|
| **Basic** | Public web server (verbatimstudio.com) | Generic, connects to localhost | Auto-update from public server |
| **Enterprise** | Customer's Verbatim server | Pre-configured with server URL | Auto-update from customer server |

### Distribution Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ELECTRON DISTRIBUTION MODEL                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      BASIC MODE DISTRIBUTION                            ││
│  │                                                                          ││
│  │   User visits: https://verbatimstudio.com/download                      ││
│  │                            │                                             ││
│  │                            ▼                                             ││
│  │   ┌─────────────────────────────────────────────┐                       ││
│  │   │         Public Download Server               │                       ││
│  │   │   (hosted by Verbatim Studio developer)     │                       ││
│  │   │                                              │                       ││
│  │   │  • Verbatim-Studio-Basic-mac-arm64.dmg     │                       ││
│  │   │  • Verbatim-Studio-Basic-mac-x64.dmg       │                       ││
│  │   │  • Verbatim-Studio-Basic-win-x64.exe       │                       ││
│  │   │  • Verbatim-Studio-Basic-linux-x64.AppImage│                       ││
│  │   │  • latest.yml (auto-update manifest)        │                       ││
│  │   └─────────────────────────────────────────────┘                       ││
│  │                            │                                             ││
│  │                            ▼                                             ││
│  │   Electron app starts with:                                             ││
│  │   • mode: 'basic'                                                       ││
│  │   • serverUrl: null (localhost only)                                    ││
│  │   • updateUrl: 'https://verbatimstudio.com/releases'                   ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ENTERPRISE MODE DISTRIBUTION                         ││
│  │                                                                          ││
│  │   Admin visits: https://verbatim.acmecorp.com/admin/downloads           ││
│  │                            │                                             ││
│  │                            ▼                                             ││
│  │   ┌─────────────────────────────────────────────┐                       ││
│  │   │        Customer's Verbatim Server           │                       ││
│  │   │   (self-hosted by enterprise customer)      │                       ││
│  │   │                                              │                       ││
│  │   │  /downloads/                                │                       ││
│  │   │  • Verbatim-Studio-AcmeCorp-mac-arm64.dmg  │                       ││
│  │   │  • Verbatim-Studio-AcmeCorp-mac-x64.dmg    │                       ││
│  │   │  • Verbatim-Studio-AcmeCorp-win-x64.exe    │                       ││
│  │   │  • Verbatim-Studio-AcmeCorp-linux.AppImage │                       ││
│  │   │  • latest.yml (auto-update manifest)        │                       ││
│  │   └─────────────────────────────────────────────┘                       ││
│  │                            │                                             ││
│  │                            ▼                                             ││
│  │   Electron app starts with:                                             ││
│  │   • mode: 'enterprise'                                                  ││
│  │   • serverUrl: 'https://verbatim.acmecorp.com'                         ││
│  │   • updateUrl: 'https://verbatim.acmecorp.com/releases'                ││
│  │   • orgName: 'Acme Corporation' (for branding)                         ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Enterprise Server Download Portal

Enterprise customers host their own Verbatim server, which includes a download portal for users to get pre-configured Electron apps.

```typescript
// Backend route for download portal
// backend/api/routes/downloads.py (NEW - Enterprise only)

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, HTMLResponse
from core.config import settings
from core.security import get_current_user, require_admin

router = APIRouter()

@router.get("/downloads")
async def downloads_page():
    """Serve download portal page (accessible to authenticated users)."""
    return HTMLResponse("""
    <html>
    <head><title>Download Verbatim Studio</title></head>
    <body>
        <h1>Download Verbatim Studio for {org_name}</h1>
        <p>Choose your operating system:</p>
        <ul>
            <li><a href="/downloads/macos-arm64">macOS (Apple Silicon)</a></li>
            <li><a href="/downloads/macos-x64">macOS (Intel)</a></li>
            <li><a href="/downloads/windows">Windows</a></li>
            <li><a href="/downloads/linux">Linux</a></li>
        </ul>
    </body>
    </html>
    """.replace("{org_name}", settings.ORG_NAME or "Your Organization"))

@router.get("/downloads/{platform}")
async def download_electron_app(platform: str):
    """Download pre-configured Electron app for platform."""
    # Map platform to filename
    filenames = {
        "macos-arm64": f"Verbatim-Studio-{settings.ORG_SLUG}-mac-arm64.dmg",
        "macos-x64": f"Verbatim-Studio-{settings.ORG_SLUG}-mac-x64.dmg",
        "windows": f"Verbatim-Studio-{settings.ORG_SLUG}-win-x64.exe",
        "linux": f"Verbatim-Studio-{settings.ORG_SLUG}-linux-x64.AppImage",
    }
    
    filename = filenames.get(platform)
    if not filename:
        raise HTTPException(404, "Platform not found")
    
    filepath = Path(settings.DOWNLOADS_PATH) / filename
    if not filepath.exists():
        raise HTTPException(404, "Download not available")
    
    return FileResponse(filepath, filename=filename)

@router.get("/releases/latest.yml")
async def get_update_manifest():
    """Serve auto-update manifest for electron-updater."""
    # Return YAML manifest for electron-builder auto-update
    return FileResponse(
        Path(settings.DOWNLOADS_PATH) / "latest.yml",
        media_type="text/yaml"
    )
```

### Baked-In Configuration

Enterprise Electron apps have configuration embedded at build time:

```typescript
// electron/src/main/bakedConfig.ts

// This file is generated during Enterprise build process
export const bakedConfig: Partial<VerbatimConfig> = {
  mode: 'enterprise',
  enterprise: {
    serverUrl: '__SERVER_URL__',      // Replaced at build time
    autoDiscover: true,
  },
  autoUpdate: true,
  updateUrl: '__UPDATE_URL__',        // Replaced at build time
  branding: {
    orgName: '__ORG_NAME__',          // Replaced at build time
    orgLogo: '__ORG_LOGO_URL__',      // Replaced at build time
  },
};
```

### Build Script for Enterprise Distributions

```bash
#!/bin/bash
# scripts/build-enterprise-electron.sh

# Arguments
SERVER_URL=$1      # e.g., https://verbatim.acmecorp.com
ORG_NAME=$2        # e.g., "Acme Corporation"
ORG_SLUG=$3        # e.g., "acmecorp"

# Generate baked config
cat > electron/src/main/bakedConfig.ts << EOF
export const bakedConfig = {
  mode: 'enterprise',
  enterprise: {
    serverUrl: '${SERVER_URL}',
    autoDiscover: true,
  },
  autoUpdate: true,
  updateUrl: '${SERVER_URL}/releases',
  branding: {
    orgName: '${ORG_NAME}',
  },
};
EOF

# Build frontend
cd frontend && npm run build:electron && cd ..

# Build Electron for all platforms
cd electron
npm run build -- \
  --mac --win --linux \
  -c.productName="Verbatim Studio - ${ORG_NAME}" \
  -c.appId="com.verbatim.studio.${ORG_SLUG}" \
  -c.publish.url="${SERVER_URL}/releases"

# Copy artifacts to server downloads directory
cp dist/*.dmg dist/*.exe dist/*.AppImage /path/to/server/downloads/
```

### Admin Interface for Managing Downloads

```typescript
// frontend/src/pages/admin/DownloadsManagementPage.tsx (NEW - Enterprise only)

export function DownloadsManagementPage() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  
  const triggerBuild = async () => {
    // Trigger server-side build process
    const response = await api.admin.triggerElectronBuild();
    setBuildStatus(response);
  };
  
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Desktop App Downloads</h1>
      
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Current Builds</h2>
        <table className="w-full">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Version</th>
              <th>Size</th>
              <th>Updated</th>
              <th>Downloads</th>
            </tr>
          </thead>
          <tbody>
            {builds.map(build => (
              <tr key={build.platform}>
                <td>{build.platformLabel}</td>
                <td>{build.version}</td>
                <td>{formatBytes(build.size)}</td>
                <td>{formatDate(build.updatedAt)}</td>
                <td>{build.downloadCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">User Download Link</h2>
        <p className="text-gray-600 mb-2">
          Share this link with your team members:
        </p>
        <code className="bg-gray-100 p-2 rounded block">
          {window.location.origin}/downloads
        </code>
      </section>
      
      <section>
        <h2 className="text-lg font-semibold mb-4">Rebuild Apps</h2>
        <p className="text-gray-600 mb-4">
          Trigger a rebuild to update configuration or version.
        </p>
        <button 
          onClick={triggerBuild}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Rebuild All Platforms
        </button>
        {buildStatus && (
          <div className="mt-4 p-4 bg-gray-50 rounded">
            <p>Status: {buildStatus.status}</p>
            {buildStatus.progress && (
              <progress value={buildStatus.progress} max={100} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
```

### Auto-Update Configuration

```typescript
// electron/src/main/updater.ts

import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import { bakedConfig } from './bakedConfig';

export function initializeUpdater(mainWindow: BrowserWindow) {
  // Configure update URL based on baked config
  if (bakedConfig.updateUrl) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: bakedConfig.updateUrl,
    });
  }
  
  // Check for updates on startup
  autoUpdater.checkForUpdatesAndNotify();
  
  // Check periodically (every 4 hours)
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
  
  // Handle update events
  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:available', info);
  });
  
  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', progress);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:downloaded', info);
  });
}

// IPC handler for manual update install
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});
```

---

## Enterprise Server

**Implementation Status:** 🔶 Partial

### Current State
- ✅ Docker Compose deployment
- ✅ FastAPI backend with all routes
- ✅ PostgreSQL database
- ✅ Redis + Celery workers
- ✅ Nginx reverse proxy
- ⬜ Discovery endpoint
- ⬜ Download portal for Electron apps
- ⬜ SSO integration

### Docker Compose (Enterprise)

**Existing File:** `docker-compose.yml` in project root

```yaml
# docker-compose.yml (EXISTING - to be enhanced)

version: '3.8'

services:
  # Reverse proxy - serves frontend + routes API
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
      - "443:443"
    volumes:
      - ./frontend/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
    depends_on:
      - verbatim-api
    restart: unless-stopped

  # FastAPI backend
  verbatim-api:
    build:
      context: ./backend
      dockerfile: ../infra/docker/backend.Dockerfile
    environment:
      - DEPLOYMENT_MODE=enterprise
      - AUTH_REQUIRED=true
      - DATABASE_URL=postgresql://verbatim:${DB_PASSWORD}@verbatim-postgres/verbatim
      - REDIS_URL=redis://verbatim-redis:6379/0
      - CELERY_BROKER_URL=redis://verbatim-redis:6379/0
      - MEDIA_STORAGE_PATH=/data/media
      - SECRET_KEY=${SECRET_KEY}
    volumes:
      - media_data:/data/media
    depends_on:
      - verbatim-postgres
      - verbatim-redis
    restart: unless-stopped

  # Background job workers
  verbatim-worker:
    build:
      context: ./backend
      dockerfile: ../infra/docker/backend.Dockerfile
    command: celery -A workers.celery_app worker --loglevel=info
    environment:
      - DEPLOYMENT_MODE=enterprise
      - DATABASE_URL=postgresql://verbatim:${DB_PASSWORD}@verbatim-postgres/verbatim
      - REDIS_URL=redis://verbatim-redis:6379/0
      - CELERY_BROKER_URL=redis://verbatim-redis:6379/0
      - MEDIA_STORAGE_PATH=/data/media
    volumes:
      - media_data:/data/media
    depends_on:
      - verbatim-postgres
      - verbatim-redis
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]

  # PostgreSQL database
  verbatim-postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=verbatim
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=verbatim
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  # Redis for job queue and caching
  verbatim-redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  media_data:
```

### Discovery Endpoint

**Implementation Status:** ⬜ Not Started

```python
# backend/api/routes/discovery.py (NEW)

from fastapi import APIRouter
from core.config import settings
from core.features import get_enabled_features

router = APIRouter()

@router.get("/api/v1/discover")
async def discover_services():
    """
    Service discovery endpoint for Enterprise clients.
    Returns available services, features, and configuration.
    """
    return {
        "version": settings.APP_VERSION,
        "mode": "enterprise",
        "services": {
            "api": settings.PUBLIC_API_URL,
            "websocket": settings.PUBLIC_WS_URL,
            "aiGateway": settings.AI_GATEWAY_URL if settings.AI_GATEWAY_ENABLED else None,
        },
        "features": [f.value for f in get_enabled_features()],
        "limits": {
            "maxUploadSizeMB": settings.MAX_UPLOAD_SIZE_MB,
            "maxConcurrentTranscriptions": settings.MAX_CONCURRENT_JOBS,
            "maxStorageGB": settings.MAX_STORAGE_GB_PER_USER,
        },
        "auth": {
            "methods": ["jwt"] + (["sso"] if settings.SSO_ENABLED else []),
            "ssoProviders": settings.SSO_PROVIDERS if settings.SSO_ENABLED else [],
        },
        "branding": {
            "name": settings.ORG_NAME or "Verbatim Studio",
            "logoUrl": settings.ORG_LOGO_URL,
        },
        "downloads": {
            "enabled": True,
            "url": f"{settings.PUBLIC_API_URL}/downloads",
        }
    }
```

---

## Database Strategy

**Implementation Status:** 🔶 Partial

| Database | Status | Notes |
|----------|--------|-------|
| PostgreSQL | ✅ Done | Full schema, RLS policies, all models |
| SQLite | ⬜ Not Started | Required for Basic mode |

### Current State
- ✅ PostgreSQL database with full schema
- ✅ SQLAlchemy ORM models (`backend/persistence/database.py`)
- ✅ Row-Level Security policies (`backend/postgres_rls.sql`)
- ✅ Migration scripts
- ⬜ SQLite dialect support
- ⬜ Database abstraction for mode switching

### Dual Database Support

```python
# backend/core/database.py (MODIFY existing persistence/database.py)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from core.config import settings

Base = declarative_base()

def get_engine():
    """Create database engine based on deployment mode."""
    db_url = settings.DATABASE_URL
    
    if db_url.startswith('sqlite'):
        # SQLite for Basic mode
        return create_engine(
            db_url,
            connect_args={"check_same_thread": False},
            echo=settings.DEBUG,
        )
    else:
        # PostgreSQL for Enterprise mode (existing)
        return create_engine(
            db_url,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            echo=settings.DEBUG,
        )

engine = get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### Schema Compatibility Notes

**Existing models** in `backend/persistence/database.py` use:
- UUID primary keys as strings ✅ (works on both SQLite and PostgreSQL)
- DateTime columns ✅ (works on both)
- JSON columns for metadata ⚠️ (needs testing on SQLite)
- Foreign key relationships ✅

**Changes needed for SQLite compatibility:**
1. Test JSON column behavior (SQLite stores as TEXT)
2. Disable RLS policies (PostgreSQL-specific)
3. Replace any PostgreSQL-specific functions

### Migration Strategy

```python
# backend/persistence/migrations/env.py (MODIFY existing)

from alembic import context
from sqlalchemy import engine_from_config, pool
from core.config import settings

def run_migrations_online():
    """Run migrations in 'online' mode."""
    
    config = context.config
    config.set_main_option('sqlalchemy.url', settings.DATABASE_URL)
    
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix='sqlalchemy.',
        poolclass=pool.NullPool,
    )
    
    with connectable.connect() as connection:
        # Detect database type
        dialect = connection.dialect.name
        
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite-specific settings
            render_as_batch=dialect == 'sqlite',  # Required for SQLite ALTER TABLE
        )
        
        with context.begin_transaction():
            context.run_migrations()
```

---

## Authentication Strategy

**Implementation Status:** 🔶 Partial

| Feature | Status | Location |
|---------|--------|----------|
| JWT authentication | ✅ Done | `backend/api/routes/auth.py` |
| User registration | ✅ Done | `backend/api/routes/auth.py` |
| Admin approval workflow | ✅ Done | User `approved` field |
| Role-based access | ✅ Done | `admin`, `user` roles |
| Auth bypass for Basic | ⬜ Not Started | Needed for single-user mode |
| SSO/SAML | ⬜ Not Started | Enterprise feature |

### Current Implementation

```python
# backend/api/routes/auth.py (EXISTING - excerpted)

@router.post("/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return JWT tokens."""
    user = db.query(UserDB).filter(UserDB.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # ... token generation
```

### Mode-Based Authentication Enhancement

```python
# backend/core/auth.py (NEW - wraps existing)

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.config import settings
from typing import Optional

security = HTTPBearer(auto_error=False)

class User:
    def __init__(self, id: str, email: str, roles: list[str]):
        self.id = id
        self.email = email
        self.roles = roles

# Default user for Basic mode
LOCAL_USER = User(
    id="local-user",
    email="local@verbatim.local",
    roles=["admin"]  # Full access in Basic mode
)

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> User:
    """Get current user based on deployment mode."""
    
    if not settings.AUTH_REQUIRED:
        # Basic mode: return local user
        return LOCAL_USER
    
    # Enterprise mode: validate JWT (existing logic from auth.py)
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = decode_token(credentials.credentials)
        return User(
            id=payload["sub"],
            email=payload["email"],
            roles=payload.get("roles", [])
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
```

---

## Configuration Schema

**Implementation Status:** 🔶 Partial

### Current State
- ✅ Backend settings (`backend/core/config.py`)
- ✅ AI configuration (`backend/core/ai_config.py`)
- ✅ Environment variable support
- ⬜ Deployment mode configuration
- ⬜ Frontend configuration schema
- ⬜ Electron configuration persistence

### Backend Configuration Enhancement

```python
# backend/core/config.py (MODIFY existing)

from pydantic_settings import BaseSettings
from enum import Enum

class DeploymentMode(str, Enum):
    BASIC = "basic"
    ENTERPRISE = "enterprise"

class Settings(BaseSettings):
    # EXISTING settings...
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    media_storage_path: str = "./data/media"
    secret_key: str
    # ... etc
    
    # NEW: Deployment mode settings
    deployment_mode: DeploymentMode = DeploymentMode.ENTERPRISE
    auth_required: bool = True
    celery_enabled: bool = True
    
    # NEW: Public URLs for discovery
    public_api_url: str = "http://localhost:8000"
    public_ws_url: str = "ws://localhost:8000"
    
    # NEW: Organization branding (Enterprise)
    org_name: Optional[str] = None
    org_logo_url: Optional[str] = None
    org_slug: Optional[str] = None
    
    # NEW: Feature toggles
    sso_enabled: bool = False
    sso_providers: list[str] = []
    
    @property
    def is_basic_mode(self) -> bool:
        return self.deployment_mode == DeploymentMode.BASIC
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
```

### Unified Frontend/Electron Configuration

```typescript
// shared/types/config.ts (NEW)

export interface VerbatimConfig {
  mode: 'basic' | 'enterprise';
  version: string;
  needsSetup: boolean;
  
  // Basic mode configuration
  basic?: BasicModeConfig;
  
  // Enterprise mode configuration
  enterprise?: EnterpriseModeConfig;
  
  // Shared settings
  ui: UIConfig;
  autoUpdate: boolean;
  telemetry: boolean;  // Anonymous usage stats (opt-in)
}

export interface BasicModeConfig {
  apiPort: number;                    // Default: 8000
  
  // AI Services (user-managed)
  ollamaUrl?: string;                 // Default: http://localhost:11434
  whisperxMode: 'embedded' | 'external';
  whisperxUrl?: string;               // If external
  
  // Storage
  dataPath?: string;                  // Override default user data path
  
  // Models
  whisperModel: string;               // Default: 'large-v3'
  embeddingModel?: string;            // For semantic search
}

export interface EnterpriseModeConfig {
  serverUrl: string;                  // e.g., https://verbatim.company.com
  autoDiscover: boolean;              // Hit /api/v1/discover for endpoints
  
  // Manual service configuration (if not auto-discover)
  services?: {
    api: string;
    websocket?: string;
    aiGateway?: string;
  };
  
  // Authentication
  authMethod: 'jwt' | 'sso';
  ssoProvider?: 'okta' | 'azure_ad' | 'google';
  ssoConfig?: SSOConfig;
}

export interface UIConfig {
  theme: 'light' | 'dark' | 'system';
  language: string;
  density: 'comfortable' | 'compact';
  sidebarCollapsed: boolean;
}
```

---

## Installation Experience

**Implementation Status:** ⬜ Not Started

### Setup Wizard Flow

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│              🎙️ Welcome to Verbatim Studio                   │
│                                                              │
│     Professional transcription for individuals and teams     │
│                                                              │
│                      [Get Started →]                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│              How will you use Verbatim?                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │   🏠  Basic (Personal)                               │   │
│  │                                                      │   │
│  │   • Single user, everything runs locally             │   │
│  │   • No server or login required                      │   │
│  │   • Perfect for individual professionals             │   │
│  │   • You manage AI services (Ollama, WhisperX)       │   │
│  │                                                      │   │
│  │                              [Select]                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │   🏢  Enterprise (Team)                              │   │
│  │                                                      │   │
│  │   • Connect to your organization's Verbatim server   │   │
│  │   • Multi-user with roles and permissions            │   │
│  │   • Meeting bots, team workspaces, advanced AI       │   │
│  │   • Centrally managed services                       │   │
│  │                                                      │   │
│  │                              [Select]                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Current Codebase Status

### Backend (`backend/`)

| Component | Status | Files |
|-----------|--------|-------|
| **API Routes** | ✅ Complete | |
| - Authentication | ✅ | `api/routes/auth.py` |
| - Recordings | ✅ | `api/routes/recordings.py` |
| - Transcripts | ✅ | `api/routes/transcripts.py` |
| - Projects | ✅ | `api/routes/projects.py` |
| - AI features | ✅ | `api/routes/ai.py` |
| - AI settings | ✅ | `api/routes/ai_settings.py` |
| - Search | ✅ | `api/routes/search.py` |
| - Export/Import | ✅ | `api/routes/export_import.py` |
| - Chat | ✅ | `api/routes/chat.py` |
| - Comments/Highlights | ✅ | `api/routes/comments.py`, `highlights.py` |
| **Core** | 🔶 Partial | |
| - Config | ✅ | `core/config.py` |
| - AI Config | ✅ | `core/ai_config.py` |
| - Security | ✅ | `core/security.py` |
| - Deployment mode | ⬜ | Needs `DEPLOYMENT_MODE` support |
| - Feature flags | ⬜ | Needs `core/features.py` |
| **AI** | ✅ Complete | |
| - Ollama client | ✅ | `ai/ollama_client.py` |
| - AI service | ✅ | `ai/service.py` |
| - Chat agent | ✅ | `ai/chat_agent.py` |
| - Cache | ✅ | `ai/cache.py` |
| **Engines** | ✅ Complete | |
| - WhisperX | ✅ | `engines/whisperx_client.py` |
| **Exports** | ✅ Complete | |
| - DOCX | ✅ | `exports/docx_export.py` |
| - PDF | ✅ | `exports/pdf_export.py` |
| - SRT/VTT | ✅ | `exports/srt.py`, `vtt.py` |
| - TXT | ✅ | `exports/txt.py` |
| **Workers** | ✅ Complete | |
| - Celery app | ✅ | `workers/celery_app.py` |
| - Transcribe task | ✅ | `workers/transcribe.py` |
| - Pyannote download | ✅ | `workers/pyannote_download.py` |
| **Persistence** | ✅ Complete | |
| - Database models | ✅ | `persistence/database.py` |
| - Migrations | ✅ | `persistence/migrations/` |

### Frontend (`frontend/`)

| Component | Status | Files |
|-----------|--------|-------|
| **Pages** | ✅ Complete | |
| - Dashboard | ✅ | `pages/DashboardPage.tsx` |
| - Projects | ✅ | `pages/ProjectsPage.tsx`, `ProjectDetailPage.tsx` |
| - Recordings | ✅ | `pages/RecordingsPage.tsx` |
| - Transcripts | ✅ | `pages/TranscriptPage.tsx` |
| - Upload | ✅ | `pages/UploadPage.tsx` |
| - Search | ✅ | `pages/SearchPage.tsx` |
| - AI Settings | ✅ | `pages/AISettingsPage.tsx` |
| - Login/Register | ✅ | `pages/LoginPage.tsx`, `RegisterPage.tsx` |
| - Admin | ✅ | `pages/admin/` |
| - Setup wizard | ⬜ | Needs `pages/Setup/` |
| **Components** | ✅ Complete | |
| - Layout | ✅ | `components/layout/` |
| - Transcript | ✅ | `components/transcript/` |
| - AI | ✅ | `components/ai/` |
| - Auth | ✅ | `components/auth/` |
| - Chat | ✅ | `components/chat/` |
| **Contexts** | 🔶 Partial | |
| - Auth context | ✅ | `contexts/AuthContext.tsx` |
| - Service provider | ⬜ | Needs `lib/services/` |
| **Lib** | ⬜ Not Started | |
| - API client | ⬜ | Needs `lib/apiClient.ts` |
| - Environment | ⬜ | Needs `lib/environment.ts` |
| - Electron | ⬜ | Needs `lib/electron.ts` |
| - Features | ⬜ | Needs `lib/features.ts` |

### Infrastructure

| Component | Status | Files |
|-----------|--------|-------|
| Docker Compose | ✅ | `docker-compose.yml` |
| Backend Dockerfile | ✅ | `infra/docker/backend.Dockerfile` |
| Nginx config | ✅ | `frontend/nginx.conf` |
| Electron app | ⬜ | Needs `electron/` directory |

---

## File Structure

### Target Project Structure

```
verbatim-studio/
├── apps/
│   ├── electron/                    # ⬜ NEW: Electron desktop application
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts
│   │   │   │   ├── windows.ts
│   │   │   │   ├── ipc.ts
│   │   │   │   ├── backend.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── tray.ts
│   │   │   │   ├── updater.ts
│   │   │   │   └── bakedConfig.ts
│   │   │   ├── preload/
│   │   │   │   └── index.ts
│   │   │   └── renderer/            # Built frontend
│   │   ├── resources/
│   │   ├── package.json
│   │   └── electron-builder.json
│   │
│   └── server/                      # 🔶 ENHANCE: Enterprise deployment configs
│       ├── docker-compose.yml       # (move from root)
│       ├── docker-compose.basic.yml # ⬜ NEW
│       └── nginx/
│
├── backend/                         # ✅ EXISTING (with enhancements)
│   ├── api/
│   │   ├── routes/                  # ✅ All routes implemented
│   │   │   ├── auth.py
│   │   │   ├── recordings.py
│   │   │   ├── transcripts.py
│   │   │   ├── projects.py
│   │   │   ├── ai.py
│   │   │   ├── discovery.py         # ⬜ NEW
│   │   │   └── downloads.py         # ⬜ NEW (Enterprise)
│   │   └── main.py
│   ├── core/
│   │   ├── config.py                # 🔶 ENHANCE: Add deployment mode
│   │   ├── ai_config.py             # ✅ Complete
│   │   ├── security.py              # ✅ Complete
│   │   ├── auth.py                  # ⬜ NEW: Mode-based auth wrapper
│   │   └── features.py              # ⬜ NEW: Feature flags
│   ├── ai/                          # ✅ Complete
│   ├── engines/                     # ✅ Complete
│   ├── exports/                     # ✅ Complete
│   ├── persistence/                 # ✅ Complete (needs SQLite testing)
│   ├── workers/                     # ✅ Complete
│   └── bots/                        # 🔶 Partial
│
├── frontend/                        # ✅ EXISTING (with enhancements)
│   ├── src/
│   │   ├── app/
│   │   │   └── App.tsx              # ✅ Complete
│   │   ├── pages/                   # ✅ All pages implemented
│   │   │   ├── Setup/               # ⬜ NEW: Setup wizard
│   │   │   └── admin/
│   │   │       └── DownloadsManagementPage.tsx  # ⬜ NEW
│   │   ├── components/              # ✅ Complete
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx      # ✅ Complete
│   │   ├── hooks/                   # ✅ Complete
│   │   └── lib/                     # ⬜ NEW: Service abstractions
│   │       ├── services/
│   │       │   ├── types.ts
│   │       │   ├── LocalServiceProvider.ts
│   │       │   ├── RemoteServiceProvider.ts
│   │       │   └── index.ts
│   │       ├── apiClient.ts
│   │       ├── environment.ts
│   │       ├── electron.ts
│   │       └── features.ts
│   ├── package.json
│   ├── vite.config.ts               # 🔶 ENHANCE: Add electron mode
│   └── nginx.conf                   # ✅ Complete
│
├── shared/                          # ⬜ NEW: Shared TypeScript types
│   └── types/
│       ├── config.ts
│       └── api.ts
│
├── scripts/                         # ⬜ NEW: Build scripts
│   ├── build-electron.sh
│   └── build-enterprise-electron.sh
│
├── docs/                            # ✅ Existing documentation
├── docker-compose.yml               # ✅ Existing
├── CLAUDE.md                        # ✅ Existing
└── README.md                        # ✅ Existing
```

---

## Implementation Checklist

### Phase 1: Foundation (Week 1-2)

**Backend Mode Support**
- [ ] Add `DEPLOYMENT_MODE` to `core/config.py`
- [ ] Add `AUTH_REQUIRED` toggle
- [ ] Add `CELERY_ENABLED` toggle
- [ ] Create `core/features.py` with feature flags
- [ ] Create `core/auth.py` mode-based wrapper
- [ ] Test existing models with SQLite
- [ ] Add `render_as_batch` to Alembic config

**Discovery Endpoint**
- [ ] Create `api/routes/discovery.py`
- [ ] Add to main router
- [ ] Include features, limits, branding

### Phase 2: Frontend Abstraction (Week 2-3)

**Service Provider Pattern**
- [ ] Create `frontend/src/lib/services/types.ts`
- [ ] Create `LocalServiceProvider.ts`
- [ ] Create `RemoteServiceProvider.ts`
- [ ] Create provider factory and hooks
- [ ] Integrate with existing AuthContext

**API Client Refactoring**
- [ ] Create `frontend/src/lib/apiClient.ts`
- [ ] Migrate existing fetch calls
- [ ] Add typed methods for all endpoints

**Environment Detection**
- [ ] Create `frontend/src/lib/environment.ts`
- [ ] Create `frontend/src/lib/electron.ts`
- [ ] Add graceful fallbacks for native features

### Phase 3: Electron Application (Week 3-5)

**Main Process**
- [ ] Set up `electron/` directory structure
- [ ] Implement main process entry point
- [ ] Implement window management
- [ ] Implement IPC handlers
- [ ] Implement backend subprocess manager (Basic mode)

**Preload Script**
- [ ] Define electronAPI interface
- [ ] Implement all IPC bridges
- [ ] Add TypeScript definitions

**Configuration**
- [ ] Implement config persistence
- [ ] Create baked config for Enterprise builds

**System Integration**
- [ ] System tray
- [ ] Native file dialogs
- [ ] Notifications
- [ ] Auto-updater

### Phase 4: Setup Experience (Week 5-6)

**Setup Wizard**
- [ ] Create `frontend/src/pages/Setup/SetupWizard.tsx`
- [ ] Welcome screen
- [ ] Mode selection
- [ ] Basic mode: services + models configuration
- [ ] Enterprise mode: server connection
- [ ] Configuration persistence

### Phase 5: Electron Distribution (Week 6-7)

**Basic Distribution**
- [ ] Set up public download server
- [ ] Build scripts for all platforms
- [ ] Auto-update manifest

**Enterprise Distribution**
- [ ] Create `api/routes/downloads.py`
- [ ] Create admin downloads management page
- [ ] Build script for custom Enterprise builds
- [ ] Auto-update from customer server

### Phase 6: Packaging & Testing (Week 7-8)

**Electron Builds**
- [ ] macOS (Universal: ARM64 + x64)
- [ ] Windows (x64)
- [ ] Linux (AppImage, deb)
- [ ] Code signing (macOS, Windows)
- [ ] Notarization (macOS)

**Testing**
- [ ] Basic mode E2E tests
- [ ] Enterprise mode E2E tests
- [ ] SQLite integration tests
- [ ] Cross-platform testing

---

## Migration Path

### From Current State to Basic + Enterprise

1. **Backend (Low Risk)**
   - Add environment variables without breaking existing deployment
   - SQLite support is additive, not replacing PostgreSQL
   - Feature flags gate new paths, don't change existing ones

2. **Frontend (Medium Risk)**
   - ServiceProvider can wrap existing fetch calls gradually
   - New lib/ files don't affect existing components
   - Setup wizard is a new route, not modifying existing ones

3. **Electron (Independent)**
   - Entirely new directory, no impact on web deployment
   - Can be developed in parallel
   - Basic mode testable without affecting Enterprise users

### Rollback Strategy

If any phase causes issues:
- Backend: Remove new env vars, existing code paths unchanged
- Frontend: Remove lib/ imports, revert to direct fetch
- Electron: Simply don't ship desktop app, web continues working

---

## Appendix: Environment Variables

### Existing Variables (Keep)

```bash
# Database
DATABASE_URL=postgresql://verbatim:password@postgres/verbatim

# Redis
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0

# Security
SECRET_KEY=your-secret-key-here

# Storage
MEDIA_STORAGE_PATH=/data/media

# AI Services
OLLAMA_URL=http://ollama:11434
WHISPERX_SERVICE_URL=http://whisperx:8000
PYANNOTE_TOKEN=hf_xxx
```

### New Variables (Add)

```bash
# Deployment Mode
DEPLOYMENT_MODE=enterprise          # 'basic' | 'enterprise'
AUTH_REQUIRED=true                   # false for Basic mode
CELERY_ENABLED=true                  # false for Basic mode

# Public URLs (for discovery endpoint)
PUBLIC_API_URL=https://verbatim.company.com
PUBLIC_WS_URL=wss://verbatim.company.com

# Organization Branding (Enterprise)
ORG_NAME=Acme Corporation
ORG_LOGO_URL=https://acme.com/logo.png
ORG_SLUG=acmecorp

# SSO (Enterprise, optional)
SSO_ENABLED=false
SSO_PROVIDERS=okta,azure_ad

# Limits
MAX_UPLOAD_SIZE_MB=500
MAX_CONCURRENT_JOBS=10
MAX_STORAGE_GB_PER_USER=50

# Downloads (Enterprise)
DOWNLOADS_PATH=/data/downloads
```

### Basic Mode Defaults

```bash
# Minimal .env for Basic mode
DEPLOYMENT_MODE=basic
AUTH_REQUIRED=false
DATABASE_URL=sqlite:///data/verbatim.db
CELERY_ENABLED=false
OLLAMA_URL=http://localhost:11434
WHISPERX_MODE=embedded
```

---

**End of Specification**

This document provides the complete architecture for Verbatim Studio supporting both Basic (local) and Enterprise (server) deployment modes. Implementation status markers (✅🔶⬜) indicate current progress against the target architecture.

**Summary of Current State:**
- ✅ Enterprise backend is production-ready
- ✅ Frontend is fully functional in browser
- 🔶 Basic mode requires SQLite support and auth bypass
- ⬜ Electron app not started
- ⬜ Setup wizard not started
- ⬜ Distribution model not started

**Estimated Timeline:** 8 weeks to complete all phases

**Next Immediate Steps:**
1. Add `DEPLOYMENT_MODE` to backend config
2. Test SQLAlchemy models with SQLite
3. Create discovery endpoint
4. Begin Electron shell development
