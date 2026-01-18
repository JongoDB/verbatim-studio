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
    list: (page = 1, pageSize = 20) =>
      this.request<RecordingListResponse>(
        `/api/recordings?page=${page}&page_size=${pageSize}`
      ),

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
  };
}

export const api = new ApiClient();
