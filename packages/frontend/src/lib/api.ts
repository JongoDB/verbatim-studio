// Backend API URL configuration
// Priority:
// 1. Electron app: use URL from main process via IPC (preload)
// 2. Electron app fallback: injected URL via executeJavaScript
// 3. VITE_API_URL environment variable
// 4. Empty string (relative URLs for same-origin)

// Extend window type for injected API URL
declare global {
  interface Window {
    __VERBATIM_API_URL__?: string;
  }
}

// Cache the API URL once resolved
let cachedApiBaseUrl: string | null = null;
let apiUrlPromise: Promise<string> | null = null;

/**
 * Initialize the API base URL.
 * In Electron, this fetches the URL from the main process.
 * Call this early in app startup.
 */
export async function initializeApiUrl(): Promise<string> {
  if (cachedApiBaseUrl !== null) {
    return cachedApiBaseUrl;
  }

  if (apiUrlPromise) {
    return apiUrlPromise;
  }

  apiUrlPromise = (async () => {
    // Debug: log what we see
    console.log('[API] Checking electronAPI:', {
      electronAPI: typeof window.electronAPI,
      hasGetApiUrl: !!(window.electronAPI as any)?.getApiUrl,
      protocol: window.location.protocol,
      keys: window.electronAPI ? Object.keys(window.electronAPI) : 'N/A'
    });

    // Check if running in Electron via preload
    if (window.electronAPI?.getApiUrl) {
      // Retry a few times in case backend isn't ready yet (e.g., on reload)
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          console.log('[API] Calling electronAPI.getApiUrl() attempt', attempt + 1);
          const url = await window.electronAPI.getApiUrl();
          console.log('[API] electronAPI.getApiUrl() returned:', url);
          if (url) {
            console.log('[API] Using Electron backend URL (preload):', url);
            cachedApiBaseUrl = url;
            return url;
          }
          // URL was null, wait and retry
          if (attempt < 4) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (err) {
          console.warn('[API] Failed to get URL from preload:', err);
          break;
        }
      }
    }

    // Check for injected URL (fallback when preload fails)
    if (window.__VERBATIM_API_URL__) {
      console.log('[API] Using injected backend URL:', window.__VERBATIM_API_URL__);
      cachedApiBaseUrl = window.__VERBATIM_API_URL__;
      return window.__VERBATIM_API_URL__;
    }

    // If running in Electron (file:// protocol) but no URL yet, wait briefly for injection
    if (window.location.protocol === 'file:') {
      console.log('[API] Running in Electron, waiting for API URL injection...');
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (window.__VERBATIM_API_URL__) {
          console.log('[API] Using injected backend URL (after wait):', window.__VERBATIM_API_URL__);
          cachedApiBaseUrl = window.__VERBATIM_API_URL__;
          return window.__VERBATIM_API_URL__;
        }
      }
      console.error('[API] Failed to get API URL in Electron - backend may not be running');
    }

    // Fall back to environment variable or empty string
    const envUrl = import.meta.env.VITE_API_URL ?? '';
    console.log('[API] Using environment URL:', envUrl || '(relative)');
    cachedApiBaseUrl = envUrl;
    return envUrl;
  })();

  return apiUrlPromise;
}

/**
 * Get the API base URL synchronously.
 * Returns cached value or empty string if not yet initialized.
 * Prefer using initializeApiUrl() at app startup.
 */
function getApiBaseUrl(): string {
  return cachedApiBaseUrl ?? import.meta.env.VITE_API_URL ?? '';
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Get the WebSocket URL for a given API path.
 * Automatically handles:
 * - Protocol (ws:// vs wss:// based on current page protocol)
 * - Host (uses current origin or API_BASE_URL if set)
 * - Development mode: connects directly to backend (Vite WS proxy unreliable)
 */
export function getWebSocketUrl(path: string): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const apiBaseUrl = getApiBaseUrl();

  if (apiBaseUrl) {
    // If API_BASE_URL is set, use it (convert http(s) to ws(s))
    const apiUrl = new URL(apiBaseUrl);
    const apiWsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${apiWsProtocol}//${apiUrl.host}${path}`;
  }

  // In development (Vite dev server), connect directly to backend
  // Vite's WebSocket proxy is unreliable for non-HMR WebSockets
  if (import.meta.env.DEV && window.location.port === '5173') {
    return `ws://127.0.0.1:8000${path}`;
  }

  // Production: use same origin (assumes reverse proxy handles WS)
  return `${wsProtocol}//${window.location.host}${path}`;
}

/**
 * Get the full API URL for a given path.
 * Uses relative URLs when API_BASE_URL is not set.
 */
export function getApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

// Interfaces matching backend response models
export interface RecordingTemplateInfo {
  id: string;
  name: string;
  description: string | null;
  metadata_schema: MetadataField[];
  is_system: boolean;
}

export interface Recording {
  id: string;
  project_ids: string[];
  template_id: string | null;
  template: RecordingTemplateInfo | null;
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

export interface FileProperties {
  id: string;
  title: string;
  file_path: string;
  file_name?: string;
  filename?: string;
  file_size: number | null;
  file_size_formatted: string;
  file_exists: boolean;
  mime_type: string | null;
  duration_seconds?: number | null;
  duration_formatted?: string | null;
  page_count?: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  storage_location: string | null;
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
  type: 'recording' | 'segment' | 'document' | 'note' | 'conversation';
  id: string;
  title: string | null;
  text: string | null;
  recording_id: string | null;
  recording_title: string | null;
  document_id: string | null;
  document_title: string | null;
  start_time: number | null;
  end_time: number | null;
  // Note fields
  note_id: string | null;
  anchor_type: string | null;
  anchor_data: Record<string, unknown> | null;
  // Conversation fields
  conversation_id: string | null;
  conversation_title: string | null;
  message_role: 'user' | 'assistant' | null;
  created_at: string;
  match_type?: 'keyword' | 'semantic' | null;
  similarity?: number | null;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  total: number;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  result_count: number;
  created_at: string;
  updated_at: string;
}

export interface SearchHistoryListResponse {
  items: SearchHistoryEntry[];
  total: number;
}

export interface DocumentSearchResult {
  document_id: string;
  document_title: string;
  chunk_text: string;
  chunk_index: number;
  similarity: number;
  page: number | null;
}

export interface DocumentSearchResponse {
  results: DocumentSearchResult[];
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

export interface ProjectTypeInfo {
  id: string;
  name: string;
  description: string | null;
  metadata_schema: MetadataField[];
  is_system: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  project_type: ProjectTypeInfo | null;
  metadata: Record<string, unknown>;
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
  project_type_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProjectUpdateRequest {
  name?: string;
  description?: string | null;
  project_type_id?: string | null;
  metadata?: Record<string, unknown>;
}

// Project Recording (for project detail page)
export interface ProjectRecording {
  id: string;
  title: string;
  file_name: string;
  duration_seconds: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRecordingsResponse {
  items: ProjectRecording[];
  total: number;
}

// Project Analytics
export interface ProjectRecordingStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}

export interface TimelineEntry {
  date: string;
  count: number;
  recording_ids: string[];
}

export interface WordFrequency {
  word: string;
  count: number;
}

export interface InheritedTag {
  id: string;
  name: string;
  color: string | null;
  recording_count: number;
}

export interface ProjectAnalytics {
  recording_stats: ProjectRecordingStats;
  total_duration_seconds: number;
  avg_duration_seconds: number | null;
  total_word_count: number;
  avg_confidence: number | null;
  recording_timeline: TimelineEntry[];
  word_frequency: WordFrequency[];
  inherited_tags: InheritedTag[];
}

// Project Type and Recording Template Types
export interface MetadataField {
  name: string;
  label: string;
  field_type: 'text' | 'textarea' | 'date' | 'number' | 'select';
  options?: string[];
  required?: boolean;
  default_value?: string;
}

export interface ProjectType {
  id: string;
  name: string;
  description: string | null;
  metadata_schema: MetadataField[];
  is_system: boolean;
  project_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTypeListResponse {
  items: ProjectType[];
  total: number;
}

export interface ProjectTypeCreateRequest {
  name: string;
  description?: string | null;
  metadata_schema?: MetadataField[];
}

export interface ProjectTypeUpdateRequest {
  name?: string;
  description?: string | null;
  metadata_schema?: MetadataField[];
}

export interface RecordingTemplate {
  id: string;
  name: string;
  description: string | null;
  metadata_schema: MetadataField[];
  is_system: boolean;
  recording_count: number;
  created_at: string;
  updated_at: string;
}

export interface RecordingTemplateListResponse {
  items: RecordingTemplate[];
  total: number;
}

export interface RecordingTemplateCreateRequest {
  name: string;
  description?: string | null;
  metadata_schema?: MetadataField[];
}

export interface RecordingTemplateUpdateRequest {
  name?: string;
  description?: string | null;
  metadata_schema?: MetadataField[];
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

export interface ChatMultiRequest {
  message: string;
  recording_ids: string[];   // Recording IDs to attach for context
  document_ids?: string[];   // Document IDs to attach for context
  file_context?: string;     // Text content from uploaded files (temporary)
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
}

export interface ChatStreamToken {
  token?: string;
  done?: boolean;
  model?: string;
  error?: string;
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

// OCR Model Types
export interface OCRModel {
  id: string;
  label: string;
  description: string;
  repo: string;
  size_bytes: number;
  is_default: boolean;
  downloaded: boolean;
  downloading: boolean;
  size_on_disk: number | null;
}

export interface OCRModelListResponse {
  models: OCRModel[];
}

export interface OCRStatusResponse {
  available: boolean;
  model_id: string | null;
  model_path: string | null;
}

export interface OCRModelDownloadEvent {
  status: 'starting' | 'progress' | 'complete' | 'error';
  model_id?: string;
  path?: string;
  error?: string;
  message?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  percent?: number;
}

// Whisper Model Types
export interface WhisperModel {
  id: string;
  label: string;
  description: string;
  repo: string;
  size_bytes: number;
  is_default: boolean;
  bundled: boolean;
  downloaded: boolean;
  active: boolean;
  size_on_disk: number | null;
}

export interface WhisperModelListResponse {
  models: WhisperModel[];
  active_model: string | null;
}

export interface WhisperModelDownloadEvent {
  status: 'starting' | 'progress' | 'complete' | 'error';
  model_id?: string;
  path?: string;
  error?: string;
  message?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
}

// Diarization Model Types (Pyannote)
export interface DiarizationModel {
  id: string;
  label: string;
  description: string;
  repo: string;
  size_bytes: number;
  required: boolean;
  downloaded: boolean;
  size_on_disk: number | null;
}

export interface DiarizationModelListResponse {
  models: DiarizationModel[];
  all_downloaded: boolean;
  hf_token_set: boolean;
}

export interface DiarizationModelDownloadEvent {
  status: 'starting' | 'progress' | 'complete' | 'error';
  model_id?: string;
  path?: string;
  error?: string;
  message?: string;
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
  templateId?: string;
  metadata?: Record<string, unknown>;
}

// Document Types
export interface Document {
  id: string;
  title: string;
  filename: string;
  file_path: string;
  mime_type: string;
  file_size_bytes: number;
  project_id: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  page_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Extracted content (may be null in list responses)
  extracted_text: string | null;
  extracted_markdown: string | null;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
}

export interface Note {
  id: string;
  content: string;
  recording_id: string | null;
  document_id: string | null;
  anchor_type: 'timestamp' | 'page' | 'paragraph' | 'selection';
  anchor_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NoteListResponse {
  items: Note[];
  total: number;
}

// Conversation types
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
}

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
}

// Browse types
export interface BrowseItem {
  id: string;
  type: 'folder' | 'recording' | 'document';
  name: string;
  updated_at: string;
  item_count?: number;
  status?: string;
  duration_seconds?: number;
  mime_type?: string;
  file_size_bytes?: number;
}

export interface BrowseResponse {
  current: BrowseItem | null;
  breadcrumb: BrowseItem[];
  items: BrowseItem[];
  total: number;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  item_count: number;
  children: FolderTreeNode[];
}

export interface FolderTreeResponse {
  root: FolderTreeNode;
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

  // External WhisperX (enterprise feature)
  mode: 'local' | 'external';
  external_url: string | null;
  external_api_key_set: boolean;
  external_api_key_masked: string | null;
  is_enterprise: boolean;

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
  // External WhisperX (enterprise feature)
  external_url?: string;
  external_api_key?: string;
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

export interface ModelBreakdown {
  llm_count: number;
  llm_bytes: number;
  asr_count: number;
  asr_bytes: number;
  diarization_count: number;
  diarization_bytes: number;
  ocr_count: number;
  ocr_bytes: number;
}

export interface StorageBreakdown {
  media_bytes: number;
  media_count: number;
  database_bytes: number;
  models: ModelBreakdown;
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

export interface MLStatus {
  whisperx_installed: boolean;
  mlx_whisper_installed: boolean;
  torch_installed: boolean;
  pyannote_installed: boolean;
  is_apple_silicon: boolean;
  recommended_engine: string | null;
  install_in_progress: boolean;
}

export interface MLInstallEvent {
  status: 'progress' | 'complete' | 'error';
  message: string;
}

export interface ResetDatabaseResponse {
  success: boolean;
  deleted: Record<string, number>;
  message: string;
}

// Storage Locations
export type StorageType = 'local' | 'network' | 'cloud';
export type StorageSubtype =
  | null
  | 'smb' | 'nfs'  // network
  | 's3' | 'azure' | 'gcs' | 'gdrive' | 'onedrive' | 'dropbox';  // cloud

export interface StorageLocationConfig {
  // Local
  path?: string;

  // Network - SMB
  server?: string;
  share?: string;
  username?: string;
  password?: string;
  domain?: string;

  // Network - NFS
  export_path?: string;
  mount_options?: string;

  // Cloud - S3
  bucket?: string;
  region?: string;
  access_key?: string;
  secret_key?: string;
  endpoint?: string;

  // Cloud - Azure
  container?: string;
  account_name?: string;
  account_key?: string;
  connection_string?: string;

  // Cloud - GCS
  project_id?: string;
  credentials_json?: string;

  // Cloud - OAuth
  folder_id?: string;
  folder_path?: string;
  oauth_tokens?: Record<string, unknown>;

  [key: string]: unknown;
}

export interface StorageLocation {
  id: string;
  name: string;
  type: StorageType;
  subtype: StorageSubtype;
  config: StorageLocationConfig;
  is_default: boolean;
  is_active: boolean;
  status: 'healthy' | 'degraded' | 'unreachable' | 'auth_expired';
  created_at: string;
  updated_at: string;
}

export interface StorageLocationListResponse {
  items: StorageLocation[];
  total: number;
}

export interface StorageLocationCreate {
  name: string;
  type?: StorageType;
  subtype?: StorageSubtype;
  config: StorageLocationConfig;
  is_default?: boolean;
}

export interface StorageLocationUpdate {
  name?: string;
  config?: StorageLocationConfig;
  is_default?: boolean;
  is_active?: boolean;
}

export interface TestConnectionRequest {
  type: StorageType;
  subtype?: StorageSubtype;
  config: StorageLocationConfig;
}

export interface TestConnectionResponse {
  success: boolean;
  error?: string;
  latency_ms?: number;
}

export interface MigrationRequest {
  source_path: string;
  destination_path: string;
}

export interface MigrationStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  total_files: number;
  migrated_files: number;
  total_bytes: number;
  migrated_bytes: number;
  current_file: string | null;
  error: string | null;
}

export interface SyncResult {
  recordings_in_db: number;
  recordings_on_disk: number;
  recordings_missing_file: number;
  recordings_imported: number;
  documents_in_db: number;
  documents_on_disk: number;
  documents_missing_file: number;
  documents_imported: number;
  storage_location_id: string;
  storage_location_name: string;
  storage_path: string;
}

// OAuth types
export interface OAuthProvider {
  id: string;
  name: string;
}

export interface OAuthStartRequest {
  provider: string;
}

export interface OAuthStartResponse {
  auth_url: string;
  state: string;
  provider: string;
}

export interface OAuthStatusResponse {
  status: 'pending' | 'complete' | 'error' | 'cancelled' | 'timeout';
  provider: string;
  error?: string;
  tokens?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    obtained_at: string;
  };
}

// OAuth Credentials types (for configuring OAuth apps)
export interface OAuthProviderCredentials {
  client_id: string;
  has_secret: boolean;
  configured: boolean;
  name: string;
  setup_url: string;
  docs_url: string;
}

export interface OAuthCredentialsResponse {
  gdrive: OAuthProviderCredentials | null;
  onedrive: OAuthProviderCredentials | null;
  dropbox: OAuthProviderCredentials | null;
}

export interface OAuthCredentialsUpdate {
  client_id: string;
  client_secret: string;
}

class ApiClient {
  private customBaseUrl?: string;

  constructor(baseUrl?: string) {
    this.customBaseUrl = baseUrl;
  }

  // Get the current base URL - uses custom URL if set, otherwise dynamic lookup
  private get baseUrl(): string {
    return this.customBaseUrl ?? getApiBaseUrl();
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const currentBaseUrl = this.baseUrl;
    const response = await fetch(`${currentBaseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      // Try to extract detailed error message from response body
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      } catch {
        // Response body wasn't JSON, use default message
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content responses (e.g., DELETE)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // Health
  health = {
    ready: () => this.request<HealthStatus>('/health/ready'),
  };

  // API info
  info = () => this.request<ApiInfo>('/api/info');

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
      templateId?: string;
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
      if (options?.templateId) params.set('template_id', options.templateId);
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
      if (options?.templateId) formData.append('template_id', options.templateId);
      if (options?.metadata && Object.keys(options.metadata).length > 0) {
        formData.append('extra_metadata', JSON.stringify(options.metadata));
      }

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

    update: (id: string, data: {
      title?: string;
      project_id?: string | null;
      template_id?: string | null;
      metadata?: Record<string, unknown>;
    }) =>
      this.request<Recording>(`/api/recordings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(data)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => {
                // Convert null to empty string for project_id and template_id to trigger unassignment
                if ((k === 'project_id' || k === 'template_id') && v === null) {
                  return [k, ''];
                }
                return [k, v];
              })
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

    getProperties: (id: string) =>
      this.request<FileProperties>(`/api/recordings/${id}/properties`),
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

    global: (query: string, options?: { limit?: number; semantic?: boolean; saveHistory?: boolean }) => {
      const params = new URLSearchParams({ q: query });
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.semantic !== undefined) params.set('semantic', options.semantic.toString());
      if (options?.saveHistory !== undefined) params.set('save_history', options.saveHistory.toString());
      return this.request<GlobalSearchResponse>(`/api/search/global?${params.toString()}`);
    },

    documents: (query: string, projectId?: string, limit = 20) => {
      const params = new URLSearchParams({ query, limit: limit.toString() });
      if (projectId) params.set('project_id', projectId);
      return this.request<DocumentSearchResponse>(`/api/search/documents?${params.toString()}`);
    },

    history: (limit = 20) =>
      this.request<SearchHistoryListResponse>(`/api/search/history?limit=${limit}`),

    clearHistory: () =>
      this.request<MessageResponse>('/api/search/history', { method: 'DELETE' }),

    deleteHistoryEntry: (entryId: string) =>
      this.request<MessageResponse>(`/api/search/history/${entryId}`, { method: 'DELETE' }),
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

    chatMultiStream: (data: ChatMultiRequest): AsyncGenerator<ChatStreamToken> => {
      const baseUrl = this.baseUrl;
      async function* streamGenerator(): AsyncGenerator<ChatStreamToken> {
        const response = await fetch(`${baseUrl}/api/ai/chat/multi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

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
                const token = JSON.parse(line.slice(6));
                yield token as ChatStreamToken;
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      }
      return streamGenerator();
    },

    extractText: async (file: File): Promise<{ text: string; format: string; page_count: number | null }> => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.baseUrl}/api/ai/extract-text`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Text extraction failed' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      return response.json();
    },
  };

  // OCR
  ocr = {
    listModels: () => this.request<OCRModelListResponse>('/api/ocr/models'),

    status: () => this.request<OCRStatusResponse>('/api/ocr/status'),

    downloadModel: (modelId: string, onEvent: (event: OCRModelDownloadEvent) => void): { abort: () => void } => {
      const abortController = new AbortController();

      fetch(`${this.baseUrl}/api/ocr/models/${modelId}/download`, {
        method: 'POST',
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          onEvent({ status: 'error', error: `HTTP ${response.status}` });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onEvent({ status: 'error', error: 'No response body' });
          return;
        }

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
                const event = JSON.parse(line.slice(6)) as OCRModelDownloadEvent;
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

    deleteModel: (modelId: string) =>
      this.request<{ status: string; model_id: string }>(
        `/api/ocr/models/${modelId}`,
        { method: 'DELETE' }
      ),

    cancelDownload: (modelId: string) =>
      this.request<{ status: string; model_id: string; was_downloading: boolean }>(
        `/api/ocr/models/${modelId}/cancel`,
        { method: 'POST' }
      ),
  };

  // Whisper (Transcription Models)
  whisper = {
    listModels: () => this.request<WhisperModelListResponse>('/api/whisper/models'),

    downloadModel: (modelId: string, onEvent: (event: WhisperModelDownloadEvent) => void): { abort: () => void } => {
      const abortController = new AbortController();

      fetch(`${this.baseUrl}/api/whisper/models/${modelId}/download`, {
        method: 'POST',
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          onEvent({ status: 'error', error: `HTTP ${response.status}` });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onEvent({ status: 'error', error: 'No response body' });
          return;
        }

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
                const event = JSON.parse(line.slice(6)) as WhisperModelDownloadEvent;
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
      this.request<{ success: boolean; message: string; model_id: string }>(
        `/api/whisper/models/${modelId}/activate`,
        { method: 'POST' }
      ),

    deleteModel: (modelId: string) =>
      this.request<{ success: boolean; message: string; model_id: string }>(
        `/api/whisper/models/${modelId}`,
        { method: 'DELETE' }
      ),
  };

  // Diarization (Pyannote Models)
  diarization = {
    listModels: () => this.request<DiarizationModelListResponse>('/api/diarization/models'),

    downloadModel: (modelId: string, onEvent: (event: DiarizationModelDownloadEvent) => void): { abort: () => void } => {
      const abortController = new AbortController();

      fetch(`${this.baseUrl}/api/diarization/models/${modelId}/download`, {
        method: 'POST',
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          // Try to get error message from response
          let errorMsg = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.detail) {
              errorMsg = errorData.detail;
            }
          } catch {
            // Ignore JSON parse errors
          }
          onEvent({ status: 'error', error: errorMsg });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onEvent({ status: 'error', error: 'No response body' });
          return;
        }

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
                const event = JSON.parse(line.slice(6)) as DiarizationModelDownloadEvent;
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

    deleteModel: (modelId: string) =>
      this.request<{ success: boolean; message: string; model_id: string }>(
        `/api/diarization/models/${modelId}`,
        { method: 'DELETE' }
      ),
  };

  // Projects
  projects = {
    list: (options?: { search?: string; projectTypeId?: string; tag?: string }) => {
      const params = new URLSearchParams();
      if (options?.search) params.set('search', options.search);
      if (options?.projectTypeId) params.set('project_type_id', options.projectTypeId);
      if (options?.tag) params.set('tag', options.tag);
      const queryString = params.toString();
      return this.request<ProjectListResponse>(`/api/projects${queryString ? `?${queryString}` : ''}`);
    },

    get: (id: string) => this.request<Project>(`/api/projects/${id}`),

    getRecordings: (projectId: string) =>
      this.request<ProjectRecordingsResponse>(`/api/projects/${projectId}/recordings`),

    analytics: (projectId: string) =>
      this.request<ProjectAnalytics>(`/api/projects/${projectId}/analytics`),

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

    delete: (id: string, options?: { deleteFiles?: boolean }) =>
      this.request<MessageResponse>(`/api/projects/${id}${options?.deleteFiles ? '?delete_files=true' : ''}`, {
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

  // Project Types
  projectTypes = {
    list: () => this.request<ProjectTypeListResponse>('/api/project-types'),

    get: (id: string) => this.request<ProjectType>(`/api/project-types/${id}`),

    create: (data: ProjectTypeCreateRequest) =>
      this.request<ProjectType>('/api/project-types', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: ProjectTypeUpdateRequest) =>
      this.request<ProjectType>(`/api/project-types/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<MessageResponse>(`/api/project-types/${id}`, {
        method: 'DELETE',
      }),
  };

  // Recording Templates
  recordingTemplates = {
    list: () => this.request<RecordingTemplateListResponse>('/api/recording-templates'),

    get: (id: string) => this.request<RecordingTemplate>(`/api/recording-templates/${id}`),

    create: (data: RecordingTemplateCreateRequest) =>
      this.request<RecordingTemplate>('/api/recording-templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: RecordingTemplateUpdateRequest) =>
      this.request<RecordingTemplate>(`/api/recording-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<MessageResponse>(`/api/recording-templates/${id}`, {
        method: 'DELETE',
      }),
  };

  // Documents
  documents = {
    list: async (params?: { project_id?: string; status?: string; search?: string }): Promise<DocumentListResponse> => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set('project_id', params.project_id);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.search) searchParams.set('search', params.search);
      const query = searchParams.toString();
      return this.request<DocumentListResponse>(`/api/documents${query ? `?${query}` : ''}`);
    },

    get: async (id: string): Promise<Document> => {
      return this.request<Document>(`/api/documents/${id}`);
    },

    upload: async (
      file: File,
      title?: string,
      projectId?: string,
      enableOcr?: boolean
    ): Promise<Document> => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      if (projectId) formData.append('project_id', projectId);
      formData.append('enable_ocr', enableOcr ? 'true' : 'false');

      const response = await fetch(`${this.baseUrl}/api/documents`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to upload document');
      return response.json();
    },

    runOcr: async (id: string): Promise<void> => {
      await this.request<{ message: string }>(`/api/documents/${id}/ocr`, {
        method: 'POST',
      });
    },

    cancelProcessing: async (id: string): Promise<void> => {
      await this.request<{ message: string }>(`/api/documents/${id}/cancel`, {
        method: 'POST',
      });
    },

    update: async (id: string, data: { title?: string; project_id?: string | null }): Promise<Document> => {
      return this.request<Document>(`/api/documents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    delete: async (id: string): Promise<void> => {
      await this.request<void>(`/api/documents/${id}`, { method: 'DELETE' });
    },

    getContent: async (id: string, format: 'text' | 'markdown' = 'markdown'): Promise<{ content: string; format: string }> => {
      return this.request<{ content: string; format: string }>(`/api/documents/${id}/content?format=${format}`);
    },

    getFileUrl: (id: string, inline: boolean = false): string =>
      `${this.baseUrl}/api/documents/${id}/file${inline ? '?inline=true' : ''}`,

    reprocess: async (id: string): Promise<void> => {
      await this.request<void>(`/api/documents/${id}/process`, { method: 'POST' });
    },

    getProperties: (id: string) =>
      this.request<FileProperties>(`/api/documents/${id}/properties`),
  };

  // Notes
  notes = {
    list: async (params: { recording_id?: string; document_id?: string }): Promise<NoteListResponse> => {
      const searchParams = new URLSearchParams();
      if (params.recording_id) searchParams.set('recording_id', params.recording_id);
      if (params.document_id) searchParams.set('document_id', params.document_id);
      return this.request<NoteListResponse>(`/api/notes?${searchParams.toString()}`);
    },

    create: async (data: {
      content: string;
      recording_id?: string;
      document_id?: string;
      anchor_type: string;
      anchor_data: Record<string, unknown>;
    }): Promise<Note> => {
      return this.request<Note>('/api/notes', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    update: async (id: string, data: { content?: string; anchor_type?: string; anchor_data?: Record<string, unknown> }): Promise<Note> => {
      return this.request<Note>(`/api/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    delete: async (id: string): Promise<void> => {
      await this.request<void>(`/api/notes/${id}`, { method: 'DELETE' });
    },
  };

  // Browse
  browse = {
    list: async (params?: {
      parent_id?: string | null;
      sort?: string;
      order?: string;
      search?: string;
    }): Promise<BrowseResponse> => {
      const searchParams = new URLSearchParams();
      if (params?.parent_id) searchParams.set('parent_id', params.parent_id);
      if (params?.sort) searchParams.set('sort', params.sort);
      if (params?.order) searchParams.set('order', params.order);
      if (params?.search) searchParams.set('search', params.search);
      const query = searchParams.toString();
      return this.request<BrowseResponse>(`/api/browse${query ? `?${query}` : ''}`);
    },

    tree: async (): Promise<FolderTreeResponse> => {
      return this.request<FolderTreeResponse>('/api/browse/tree');
    },

    move: async (itemId: string, itemType: 'recording' | 'document', targetProjectId: string | null): Promise<{ message: string; item: BrowseItem }> => {
      return this.request<{ message: string; item: BrowseItem }>('/api/browse/move', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          item_type: itemType,
          target_project_id: targetProjectId,
        }),
      });
    },

    copy: async (itemId: string, itemType: 'recording' | 'document', targetProjectId: string | null): Promise<{ message: string; item: BrowseItem }> => {
      return this.request<{ message: string; item: BrowseItem }>('/api/browse/copy', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          item_type: itemType,
          target_project_id: targetProjectId,
        }),
      });
    },

    rename: async (itemId: string, itemType: 'folder' | 'recording' | 'document', newName: string): Promise<{ message: string; item: BrowseItem }> => {
      return this.request<{ message: string; item: BrowseItem }>('/api/browse/rename', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          item_type: itemType,
          new_name: newName,
        }),
      });
    },

    delete: async (itemType: 'folder' | 'recording' | 'document', itemId: string, deleteFiles?: boolean): Promise<{ message: string }> => {
      const query = deleteFiles ? '?delete_files=true' : '';
      return this.request<{ message: string }>(`/api/browse/${itemType}/${itemId}${query}`, {
        method: 'DELETE',
      });
    },
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

    // OAuth Credentials
    getOAuthCredentials: () =>
      this.request<OAuthCredentialsResponse>('/api/config/oauth-credentials'),

    getOAuthCredentialsForProvider: (provider: string) =>
      this.request<OAuthProviderCredentials>(`/api/config/oauth-credentials/${provider}`),

    setOAuthCredentials: (provider: string, data: OAuthCredentialsUpdate) =>
      this.request<OAuthProviderCredentials>(`/api/config/oauth-credentials/${provider}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteOAuthCredentials: (provider: string) =>
      this.request<{ deleted: boolean }>(`/api/config/oauth-credentials/${provider}`, {
        method: 'DELETE',
      }),
  };

  // System
  system = {
    info: () => this.request<SystemInfo>('/api/system/info'),
    mlStatus: () => this.request<MLStatus>('/api/system/ml-status'),
    installMl: async function* (): AsyncGenerator<MLInstallEvent> {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/system/install-ml`, {
        method: 'POST',
      });

      if (!response.ok) {
        yield { status: 'error', message: `HTTP ${response.status}: ${response.statusText}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { status: 'error', message: 'No response body' };
        return;
      }

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
              const data = JSON.parse(line.slice(6)) as MLInstallEvent;
              yield data;
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    },
    resetDatabase: (deleteMedia: boolean) =>
      this.request<ResetDatabaseResponse>('/api/system/reset-database', {
        method: 'POST',
        body: JSON.stringify({ delete_media: deleteMedia }),
      }),
  };

  // Storage Locations
  storageLocations = {
    list: () => this.request<StorageLocationListResponse>('/api/storage-locations'),
    get: (id: string) => this.request<StorageLocation>(`/api/storage-locations/${id}`),
    create: (data: StorageLocationCreate) =>
      this.request<StorageLocation>('/api/storage-locations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: StorageLocationUpdate) =>
      this.request<StorageLocation>(`/api/storage-locations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      this.request<void>(`/api/storage-locations/${id}`, {
        method: 'DELETE',
      }),
    test: (data: TestConnectionRequest) =>
      this.request<TestConnectionResponse>('/api/storage-locations/test', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    migrate: (data: MigrationRequest) =>
      this.request<MigrationStatus>('/api/storage-locations/migrate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getMigrationStatus: () =>
      this.request<MigrationStatus>('/api/storage-locations/migrate/status'),
    sync: () =>
      this.request<SyncResult>('/api/storage-locations/sync', {
        method: 'POST',
      }),
  };

  // OAuth API
  oauth = {
    providers: () =>
      this.request<{ providers: OAuthProvider[] }>('/api/oauth/providers'),
    start: (data: OAuthStartRequest) =>
      this.request<OAuthStartResponse>('/api/oauth/start', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    status: (state: string) =>
      this.request<OAuthStatusResponse>(`/api/oauth/status/${state}`),
    cancel: (state: string) =>
      this.request<{ message: string; state: string }>(`/api/oauth/cancel/${state}`, {
        method: 'POST',
      }),
  };

  // Conversations (saved chats)
  conversations = {
    list: () => this.request<ConversationListResponse>('/api/conversations'),

    get: (id: string) => this.request<ConversationDetail>(`/api/conversations/${id}`),

    create: (data: { title?: string; messages: Array<{ role: string; content: string }> }) =>
      this.request<ConversationDetail>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: { title?: string }) =>
      this.request<ConversationDetail>(`/api/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<{ deleted: boolean }>(`/api/conversations/${id}`, {
        method: 'DELETE',
      }),

    addMessage: (id: string, role: string, content: string) =>
      this.request<ConversationMessage>(`/api/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ role, content }),
      }),
  };
}

export const api = new ApiClient();
