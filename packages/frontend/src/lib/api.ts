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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
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

export interface Segment {
  id: string;
  segment_index: number;
  speaker: string | null;
  start_time: number;
  end_time: number;
  text: string;
  confidence: number | null;
  edited: boolean;
  created_at: string;
  updated_at: string;
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
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  total: number;
}

export interface ExportOptions {
  format: ExportFormat;
  includeTimestamps?: boolean;
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
    }) => {
      const params = new URLSearchParams();
      params.set('page', String(options?.page ?? 1));
      params.set('page_size', String(options?.pageSize ?? 20));
      if (options?.projectId) params.set('project_id', options.projectId);
      if (options?.status) params.set('status', options.status);
      if (options?.search) params.set('search', options.search);
      if (options?.sortBy) params.set('sort_by', options.sortBy);
      if (options?.sortOrder) params.set('sort_order', options.sortOrder);
      return this.request<RecordingListResponse>(`/api/recordings?${params.toString()}`);
    },

    get: (id: string) => this.request<Recording>(`/api/recordings/${id}`),

    upload: async (file: File, title?: string): Promise<RecordingCreateResponse> => {
      const formData = new FormData();
      formData.append('file', file);

      const queryParams = new URLSearchParams();
      if (title) {
        queryParams.set('title', title);
      }

      const queryString = queryParams.toString();
      const url = `${this.baseUrl}/api/recordings/upload${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        // Note: Don't set Content-Type header - browser will set it with boundary for multipart
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

    update: (speakerId: string, data: SpeakerUpdateRequest) =>
      this.request<Speaker>(`/api/speakers/${speakerId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
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

    global: (query: string, limit = 20) => {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      return this.request<GlobalSearchResponse>(`/api/search/global?${params.toString()}`);
    },
  };
}

export const api = new ApiClient();
