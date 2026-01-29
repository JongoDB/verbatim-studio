// Backend API URL - default to localhost for dev
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

// Interfaces matching backend response models
export interface Recording {
  id: string;
  project_id: string | null;
  title: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  duration_seconds: number | null;
  mime_type: string | null;
  metadata: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  tag_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface TagListResponse {
  items: Tag[];
}

export interface UniqueSpeaker {
  name: string;
  count: number;
}

export interface UniqueSpeakerListResponse {
  items: UniqueSpeaker[];
}

export interface RecordingListResponse {
  items: Recording[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface RecordingCreateResponse {
  id: string;
  title: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  status: string;
  created_at: string;
}

export interface TranscribeResponse {
  job_id: string;
  status: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobListResponse {
  items: Job[];
  total: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple' | 'orange';

export interface Segment {
  id: string;
  segment_index: number;
  speaker: string | null;
  start_time: number;
  end_time: number;
  text: string;
  confidence: number | null;
  edited: boolean;
  highlight_color: HighlightColor | null;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface SegmentComment {
  id: string;
  segment_id: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface CommentListResponse {
  items: SegmentComment[];
}

export interface Transcript {
  id: string;
  recording_id: string;
  language: string | null;
  model_used: string | null;
  confidence_avg: number | null;
  word_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptWithSegments extends Transcript {
  segments: Segment[];
}

export interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export interface ApiInfo {
  name: string;
  version: string;
  mode: string;
}

export interface MessageResponse {
  message: string;
  id: string | null;
}

export interface Speaker {
  id: string;
  transcript_id: string;
  speaker_label: string;
  speaker_name: string | null;
  color: string | null;
}

export interface SpeakerListResponse {
  items: Speaker[];
}

export interface SpeakerUpdateRequest {
  speaker_name?: string | null;
  color?: string | null;
}

export type ExportFormat = 'txt' | 'srt' | 'vtt' | 'docx' | 'pdf';

export interface SearchResultSegment {
  id: string;
  segment_index: number;
  speaker: string | null;
  start_time: number;
  end_time: number;
  text: string;
  confidence: number | null;
  transcript_id: string;
  recording_id: string;
  recording_title: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultSegment[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface GlobalSearchResult {
  type: 'recording' | 'segment';
  id: string;
  title: string | null;
  text: string | null;
  recording_id: string;
  recording_title: string;
  start_time: number | null;
  end_time: number | null;
  created_at: string;
  match_type?: 'keyword' | 'semantic' | null;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  total: number;
}

export interface RecordingStats {
  total_recordings: number;
  total_duration_seconds: number;
  by_status: Record<string, number>;
  avg_duration_seconds: number | null;
}

export interface TranscriptionStats {
  total_transcripts: number;
  total_segments: number;
  total_words: number;
  languages: Record<string, number>;
}

export interface ProjectStats {
  total_projects: number;
  last_updated: string | null;
}

export interface ProcessingStats {
  active_count: number;
  queued_count: number;
  running_count: number;
}

export interface DashboardStats {
  recordings: RecordingStats;
  transcriptions: TranscriptionStats;
  projects: ProjectStats;
  processing: ProcessingStats;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  recording_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectListResponse {
  items: Project[];
  total: number;
}

export interface ProjectCreateRequest {
  name: string;
  description?: string | null;
}

export interface ProjectUpdateRequest {
  name?: string;
  description?: string | null;
}

// AI Types
export interface AIStatusResponse {
  available: boolean;
  provider: string;
  model_loaded: boolean;
  model_path: string | null;
  models: Array<{ id: string; name: string }>;
}

export interface AIChatRequest {
  message: string;
  context?: string | null;
  temperature?: number;
  max_tokens?: number | null;
}

export interface AIChatResponse {
  content: string;
  model: string;
}

export interface SummarizationResponse {
  summary: string;
  key_points: string[] | null;
  action_items: string[] | null;
  topics: string[] | null;
  named_entities: string[] | null;
}

export interface AnalysisResponse {
  analysis_type: string;
  content: Record<string, unknown>;
}

export type AnalysisType = 'sentiment' | 'topics' | 'entities' | 'questions' | 'action_items';

// AI Model Management Types
export interface AIModel {
  id: string;
  label: string;
  description: string;
  repo: string;
  filename: string;
  size_bytes: number;
  is_default: boolean;
  downloaded: boolean;
  active: boolean;
  download_path: string | null;
}

export interface AIModelListResponse {
  models: AIModel[];
}

export interface AIModelDownloadEvent {
  status: 'starting' | 'progress' | 'complete' | 'activated' | 'error';
  model_id?: string;
  path?: string;
  error?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
}

// Archive Types
export interface ArchiveInfo {
  version: string;
  created_at: string;
  recordings_count: number;
  transcripts_count: number;
  projects_count: number;
  media_size_bytes: number;
}

export interface ImportResponse {
  message: string;
  recordings_imported: number;
  transcripts_imported: number;
  projects_imported: number;
  errors: string[];
}

export interface ExportOptions {
  format: ExportFormat;
  includeTimestamps?: boolean;
}

// Quality presets for recording
export const QUALITY_PRESETS = {
  low: { label: 'Low', bitrate: 64000, tagline: 'Meetings, drafts', sizeMbPerMin: 0.5 },
  medium: { label: 'Medium', bitrate: 128000, tagline: 'General use', sizeMbPerMin: 1.0 },
  high: { label: 'High', bitrate: 192000, tagline: 'Interviews', sizeMbPerMin: 1.4 },
  lossless: { label: 'Lossless', bitrate: 320000, tagline: 'Archival, legal', sizeMbPerMin: 2.4 },
} as const;

export type QualityPreset = keyof typeof QUALITY_PRESETS;

export interface RecordingUploadOptions {
  title?: string;
  description?: string;
  tags?: string[];
  participants?: string[];
  location?: string;
  recordedDate?: string;
  quality?: string;
}

// Config Types
export interface WhisperXStatus {
  mode: 'local' | 'external';
  external_url: string | null;
  model: string;
  device: string;
  compute_type: string;
}

export interface AIConfigStatus {
  model_path: string | null;
  context_size: number;
  gpu_layers: number;
}

export interface ConfigStatus {
  mode: string;
  whisperx: WhisperXStatus;
  ai: AIConfigStatus;
}

export interface PresetInfo {
  model: string;
  compute_type: string;
  batch_size: number;
}

export interface TranscriptionSettings {
  // Engine selection
  engine: string;
  effective_engine: string;
  available_engines: string[];
  engine_caveats: string[];

  // Settings
  model: string;
  device: string;
  compute_type: string;
  batch_size: number;
  diarize: boolean;
  hf_token_set: boolean;
  hf_token_masked: string | null;
  mode: 'local' | 'external';
  external_url: string | null;
  available_models: string[];
  available_devices: string[];
  available_compute_types: string[];
  available_batch_sizes: number[];
  presets: Record<string, PresetInfo>;
}

export interface TranscriptionSettingsUpdate {
  engine?: string;
  model?: string;
  device?: string;
  compute_type?: string;
  batch_size?: number;
  diarize?: boolean;
  hf_token?: string;
}

// System Info Types
export interface StoragePaths {
  data_dir: string;
  media_dir: string;
  models_dir: string;
  database_path: string;
}

export interface DiskUsage {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent_used: number;
}

export interface StorageBreakdown {
  media_bytes: number;
  media_count: number;
  database_bytes: number;
  models_bytes: number;
  models_count: number;
  total_bytes: number;
}

export interface ContentCounts {
  recordings: number;
  transcripts: number;
  segments: number;
}

export interface SystemInfo {
  app_version: string;
  python_version: string;
  platform: string;
  platform_version: string;
  paths: StoragePaths;
  disk_usage: DiskUsage;
  storage_breakdown: StorageBreakdown;
  content_counts: ContentCounts;
  max_upload_bytes: number;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health
  health = {
    ready: () => this.request<HealthStatus>('/health/ready'),
  };

  // Root info
  info = () => this.request<ApiInfo>('/');

  // Recordings
  recordings = {
    list: (options?: {
      page?: number;
      pageSize?: number;
      projectId?: string;
      status?: string;
      search?: string;
      sortBy?: 'created_at' | 'title' | 'duration';
      sortOrder?: 'asc' | 'desc';
      dateFrom?: string;
      dateTo?: string;
      tagIds?: string[];
      speaker?: string;
    }) => {
      const params = new URLSearchParams();
      params.set('page', String(options?.page ?? 1));
      params.set('page_size', String(options?.pageSize ?? 20));
      if (options?.projectId) params.set('project_id', options.projectId);
      if (options?.status) params.set('status', options.status);
      if (options?.search) params.set('search', options.search);
      if (options?.sortBy) params.set('sort_by', options.sortBy);
      if (options?.sortOrder) params.set('sort_order', options.sortOrder);
      if (options?.dateFrom) params.set('date_from', options.dateFrom);
      if (options?.dateTo) params.set('date_to', options.dateTo);
      if (options?.tagIds?.length) params.set('tag_ids', options.tagIds.join(','));
      if (options?.speaker) params.set('speaker', options.speaker);
      return this.request<RecordingListResponse>(`/api/recordings?${params.toString()}`);
    },

    get: (id: string) => this.request<Recording>(`/api/recordings/${id}`),

    upload: async (file: File, options?: RecordingUploadOptions): Promise<RecordingCreateResponse> => {
      const formData = new FormData();
      formData.append('file', file);

      if (options?.title) formData.append('title', options.title);
      if (options?.description) formData.append('description', options.description);
      if (options?.tags?.length) formData.append('tags', options.tags.join(','));
      if (options?.participants?.length) formData.append('participants', options.participants.join(','));
      if (options?.location) formData.append('location', options.location);
      if (options?.recordedDate) formData.append('recorded_date', options.recordedDate);
      if (options?.quality) formData.append('quality', options.quality);

      const response = await fetch(`${this.baseUrl}/api/recordings/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },

    delete: (id: string) =>
      this.request<MessageResponse>(`/api/recordings/${id}`, {
        method: 'DELETE',
      }),

    update: (id: string, data: { title?: string; project_id?: string | null }) =>
      this.request<Recording>(`/api/recordings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === null ? '' : v])
          )
        ),
      }),

    transcribe: (id: string, language?: string) => {
      const queryParams = new URLSearchParams();
      if (language) {
        queryParams.set('language', language);
      }
      const queryString = queryParams.toString();
      return this.request<TranscribeResponse>(
        `/api/recordings/${id}/transcribe${queryString ? `?${queryString}` : ''}`,
        { method: 'POST' }
      );
    },

    cancel: (id: string) =>
      this.request<MessageResponse>(`/api/recordings/${id}/cancel`, {
        method: 'POST',
      }),

    retry: (id: string) =>
      this.request<TranscribeResponse>(`/api/recordings/${id}/retry`, {
        method: 'POST',
      }),

    bulkDelete: (ids: string[]) =>
      this.request<MessageResponse>(`/api/recordings/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),

    bulkAssign: (ids: string[], projectId: string | null) =>
      this.request<MessageResponse>(`/api/recordings/bulk-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, project_id: projectId }),
      }),

    getAudioUrl: (id: string) => `${this.baseUrl}/api/recordings/${id}/audio`,
  };

  // Jobs
  jobs = {
    list: (status?: string, limit = 100) => {
      const queryParams = new URLSearchParams();
      if (status) {
        queryParams.set('status', status);
      }
      queryParams.set('limit', limit.toString());
      return this.request<JobListResponse>(`/api/jobs?${queryParams.toString()}`);
    },

    get: (id: string) => this.request<Job>(`/api/jobs/${id}`),
  };

  // Transcripts
  transcripts = {
    get: (id: string) =>
      this.request<TranscriptWithSegments>(`/api/transcripts/${id}`),

    byRecording: (recordingId: string) =>
      this.request<TranscriptWithSegments>(
        `/api/transcripts/by-recording/${recordingId}`
      ),

    updateSegment: (transcriptId: string, segmentId: string, data: { text?: string; speaker?: string }) =>
      this.request<Segment>(`/api/transcripts/${transcriptId}/segments/${segmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    export: async (transcriptId: string, options: ExportOptions): Promise<Blob> => {
      const queryParams = new URLSearchParams();
      queryParams.set('format', options.format);
      if (options.includeTimestamps !== undefined) {
        queryParams.set('include_timestamps', String(options.includeTimestamps));
      }

      const response = await fetch(
        `${this.baseUrl}/api/transcripts/${transcriptId}/export?${queryParams.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      return response.blob();
    },

    getExportUrl: (transcriptId: string, format: ExportFormat, includeTimestamps = true) => {
      const queryParams = new URLSearchParams();
      queryParams.set('format', format);
      queryParams.set('include_timestamps', String(includeTimestamps));
      return `${this.baseUrl}/api/transcripts/${transcriptId}/export?${queryParams.toString()}`;
    },
  };

  // Speakers
  speakers = {
    byTranscript: (transcriptId: string) =>
      this.request<SpeakerListResponse>(`/api/speakers/by-transcript/${transcriptId}`),

    unique: () => this.request<UniqueSpeakerListResponse>('/api/speakers/unique'),

    update: (speakerId: string, data: SpeakerUpdateRequest) =>
      this.request<Speaker>(`/api/speakers/${speakerId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    merge: (speakerId: string, targetSpeakerId: string) =>
      this.request<{ speaker: Speaker; segments_moved: number }>(
        `/api/speakers/${speakerId}/merge`,
        {
          method: 'POST',
          body: JSON.stringify({ target_speaker_id: targetSpeakerId }),
        },
      ),

    reassignSegment: (transcriptId: string, segmentId: string, speakerName: string) =>
      this.request<{ segment: Segment; speakers: Speaker[] }>(
        '/api/speakers/reassign-segment',
        {
          method: 'POST',
          body: JSON.stringify({
            transcript_id: transcriptId,
            segment_id: segmentId,
            speaker_name: speakerName,
          }),
        },
      ),
  };

  // Comments
  comments = {
    list: (segmentId: string) =>
      this.request<CommentListResponse>(`/api/segments/${segmentId}/comments`),

    create: (segmentId: string, text: string) =>
      this.request<SegmentComment>(`/api/segments/${segmentId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),

    update: (commentId: string, text: string) =>
      this.request<SegmentComment>(`/api/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      }),

    delete: (commentId: string) =>
      this.request<MessageResponse>(`/api/comments/${commentId}`, {
        method: 'DELETE',
      }),
  };

  // Highlights
  highlights = {
    set: (segmentId: string, color: HighlightColor) =>
      this.request<{ id: string; segment_id: string; color: string; created_at: string }>(
        `/api/segments/${segmentId}/highlight`,
        {
          method: 'PUT',
          body: JSON.stringify({ color }),
        }
      ),

    remove: (segmentId: string) =>
      this.request<MessageResponse>(`/api/segments/${segmentId}/highlight`, {
        method: 'DELETE',
      }),

    bulkSet: (transcriptId: string, segmentIds: string[], color: HighlightColor) =>
      this.request<MessageResponse>(`/api/transcripts/${transcriptId}/bulk-highlight`, {
        method: 'POST',
        body: JSON.stringify({ segment_ids: segmentIds, color }),
      }),

    bulkRemove: (transcriptId: string, segmentIds: string[]) =>
      this.request<MessageResponse>(`/api/transcripts/${transcriptId}/bulk-highlight`, {
        method: 'POST',
        body: JSON.stringify({ segment_ids: segmentIds, remove: true }),
      }),
  };

  // Tags
  tags = {
    list: () => this.request<TagListResponse>('/api/tags'),

    create: (name: string, color?: string) =>
      this.request<Tag>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      }),

    delete: (tagId: string) =>
      this.request<MessageResponse>(`/api/tags/${tagId}`, {
        method: 'DELETE',
      }),

    forRecording: (recordingId: string) =>
      this.request<TagListResponse>(`/api/tags/recordings/${recordingId}`),

    assign: (recordingId: string, tagId: string) =>
      this.request<MessageResponse>(`/api/tags/recordings/${recordingId}`, {
        method: 'POST',
        body: JSON.stringify({ tag_id: tagId }),
      }),

    remove: (recordingId: string, tagId: string) =>
      this.request<MessageResponse>(`/api/tags/recordings/${recordingId}/${tagId}`, {
        method: 'DELETE',
      }),
  };

  // Search
  search = {
    segments: (query: string, options?: {
      transcriptId?: string;
      recordingId?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const params = new URLSearchParams({ q: query });
      if (options?.transcriptId) params.set('transcript_id', options.transcriptId);
      if (options?.recordingId) params.set('recording_id', options.recordingId);
      if (options?.page) params.set('page', String(options.page));
      if (options?.pageSize) params.set('page_size', String(options.pageSize));
      return this.request<SearchResponse>(`/api/search/segments?${params.toString()}`);
    },

    global: (query: string, options?: { limit?: number; semantic?: boolean }) => {
      const params = new URLSearchParams({ q: query });
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.semantic !== undefined) params.set('semantic', options.semantic.toString());
      return this.request<GlobalSearchResponse>(`/api/search/global?${params.toString()}`);
    },
  };

  // Stats
  stats = {
    dashboard: () => this.request<DashboardStats>('/api/stats'),
  };

  // Archive
  archive = {
    info: () => this.request<ArchiveInfo>('/api/archive/info'),

    exportUrl: (includeMedia = true) =>
      `${this.baseUrl}/api/archive/export?include_media=${includeMedia}`,

    import: async (file: File, merge = true): Promise<ImportResponse> => {
      const formData = new FormData();
      formData.append('file', file);

      const params = new URLSearchParams({ merge: String(merge) });
      const response = await fetch(
        `${this.baseUrl}/api/archive/import?${params.toString()}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`Import failed: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
  };

  // AI
  ai = {
    status: () => this.request<AIStatusResponse>('/api/ai/status'),

    chat: (data: AIChatRequest) =>
      this.request<AIChatResponse>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    summarize: (transcriptId: string, temperature = 0.3) => {
      const params = new URLSearchParams({ temperature: String(temperature) });
      return this.request<SummarizationResponse>(
        `/api/ai/transcripts/${transcriptId}/summarize?${params.toString()}`,
        { method: 'POST' }
      );
    },

    analyze: (transcriptId: string, analysisType: AnalysisType, temperature = 0.3) => {
      const params = new URLSearchParams({
        analysis_type: analysisType,
        temperature: String(temperature),
      });
      return this.request<AnalysisResponse>(
        `/api/ai/transcripts/${transcriptId}/analyze?${params.toString()}`,
        { method: 'POST' }
      );
    },

    ask: (transcriptId: string, question: string, temperature = 0.5) => {
      const params = new URLSearchParams({
        question,
        temperature: String(temperature),
      });
      return this.request<AIChatResponse>(
        `/api/ai/transcripts/${transcriptId}/ask?${params.toString()}`,
        { method: 'POST' }
      );
    },

    listModels: () => this.request<AIModelListResponse>('/api/ai/models'),

    downloadModel: (modelId: string, onEvent: (event: AIModelDownloadEvent) => void): { abort: () => void } => {
      const abortController = new AbortController();

      fetch(`${this.baseUrl}/api/ai/models/${modelId}/download`, {
        method: 'POST',
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          onEvent({ status: 'error', error: `HTTP ${response.status}` });
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as AIModelDownloadEvent;
                onEvent(event);
              } catch {
                // skip malformed lines
              }
            }
          }
        }
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          onEvent({ status: 'error', error: err.message });
        }
      });

      return { abort: () => abortController.abort() };
    },

    activateModel: (modelId: string) =>
      this.request<{ status: string; model_id: string; path: string }>(
        `/api/ai/models/${modelId}/activate`,
        { method: 'POST' }
      ),

    deleteModel: (modelId: string) =>
      this.request<{ status: string; model_id: string }>(
        `/api/ai/models/${modelId}`,
        { method: 'DELETE' }
      ),
  };

  // Projects
  projects = {
    list: (search?: string) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const queryString = params.toString();
      return this.request<ProjectListResponse>(`/api/projects${queryString ? `?${queryString}` : ''}`);
    },

    get: (id: string) => this.request<Project>(`/api/projects/${id}`),

    create: (data: ProjectCreateRequest) =>
      this.request<Project>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: ProjectUpdateRequest) =>
      this.request<Project>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<MessageResponse>(`/api/projects/${id}`, {
        method: 'DELETE',
      }),

    addRecording: (projectId: string, recordingId: string) =>
      this.request<MessageResponse>(`/api/projects/${projectId}/recordings/${recordingId}`, {
        method: 'POST',
      }),

    removeRecording: (projectId: string, recordingId: string) =>
      this.request<MessageResponse>(`/api/projects/${projectId}/recordings/${recordingId}`, {
        method: 'DELETE',
      }),
  };

  // Config
  config = {
    status: () => this.request<ConfigStatus>('/api/config/status'),

    getTranscription: () =>
      this.request<TranscriptionSettings>('/api/config/transcription'),

    updateTranscription: (data: TranscriptionSettingsUpdate) =>
      this.request<TranscriptionSettings>('/api/config/transcription', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  };

  // System
  system = {
    info: () => this.request<SystemInfo>('/api/system/info'),
  };
}

export const api = new ApiClient();
