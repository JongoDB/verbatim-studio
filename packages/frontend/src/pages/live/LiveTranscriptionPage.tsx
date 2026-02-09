import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiUrl } from '@/lib/api';
import { useLiveTranscription } from '@/hooks/useLiveTranscription';

interface LiveTranscriptionPageProps {
  onNavigateToRecordings: () => void;
  onViewRecording: (recordingId: string) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
];

export function LiveTranscriptionPage({ onNavigateToRecordings: _onNavigateToRecordings, onViewRecording }: LiveTranscriptionPageProps) {
  const {
    connectionState,
    sessionId,
    segments,
    duration,
    error,
    lastAutoSave,
    fullText,
    wordCount,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    clearTranscript,
    dismissError,
  } = useLiveTranscription();

  const [language, setLanguage] = useState('en');
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveAudio, setSaveAudio] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  const handleStartRecording = useCallback(() => {
    startRecording(language);
  }, [startRecording, language]);

  const downloadTranscript = useCallback(() => {
    const text = segments.map(s => s.text).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `live-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [segments]);

  const handleSave = useCallback(async () => {
    if (!sessionId || !saveTitle.trim()) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(getApiUrl('/api/live/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          title: saveTitle.trim(),
          save_audio: saveAudio,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save session');
      }

      const data = await response.json();
      setShowSaveDialog(false);
      setSaveTitle('');
      clearTranscript();

      onViewRecording(data.recording_id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, saveTitle, saveAudio, clearTranscript, onViewRecording]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Live Transcription</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Real-time speech-to-text with low-latency processing
            </p>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className={`p-4 rounded-lg border ${
          error.retryable
            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        }`}>
          <div className={`flex items-center gap-2 ${
            error.retryable
              ? 'text-yellow-700 dark:text-yellow-400'
              : 'text-red-700 dark:text-red-400'
          }`}>
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm">{error.message}</span>
            <button onClick={dismissError} className="ml-auto text-sm underline shrink-0">Dismiss</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Connection & Recording */}
        <div className="space-y-4">
          {/* Connection Card */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Connection</h2>

            {/* Status */}
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2.5 h-2.5 rounded-full ${
                connectionState === 'disconnected' ? 'bg-gray-400' :
                connectionState === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                connectionState === 'connected' ? 'bg-green-400' :
                'bg-red-400 animate-pulse'
              }`} />
              <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                {connectionState === 'recording' ? 'Recording' : connectionState}
              </span>
            </div>

            {/* Language Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={connectionState === 'recording'}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>

            {/* Connect/Disconnect Button */}
            {connectionState === 'disconnected' ? (
              <button
                onClick={connect}
                className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
              >
                Connect
              </button>
            ) : (
              <button
                onClick={disconnect}
                disabled={connectionState === 'connecting'}
                className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>

          {/* Recording Card */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recording</h2>

            {/* Timer */}
            <div className="text-4xl font-mono font-bold text-center text-gray-900 dark:text-gray-100 mb-4">
              {formatTime(duration)}
            </div>

            {/* Record Button */}
            {connectionState === 'recording' ? (
              <button
                onClick={stopRecording}
                className="w-full py-3 rounded-lg bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors flex items-center justify-center gap-2"
              >
                <span className="w-3 h-3 rounded-sm bg-white" />
                Stop Recording
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={connectionState !== 'connected'}
                className="w-full py-3 rounded-lg bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Start Recording
              </button>
            )}

            {connectionState === 'disconnected' && (
              <p className="mt-2 text-xs text-center text-gray-500 dark:text-gray-400">
                Connect to server first
              </p>
            )}

            {/* Autosave indicator */}
            {lastAutoSave && connectionState === 'recording' && (
              <p className="mt-2 text-xs text-center text-green-600 dark:text-green-400">
                Auto-saved {lastAutoSave.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Right Panel - Transcript */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 h-full flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Transcript</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowSaveDialog(true)}
                  disabled={segments.length === 0 || !sessionId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </button>
                <button
                  onClick={downloadTranscript}
                  disabled={segments.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
                <button
                  onClick={clearTranscript}
                  disabled={segments.length === 0}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Transcript Content */}
            <div className="flex-1 p-5 overflow-y-auto min-h-[400px] max-h-[600px]">
              {segments.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                  <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p className="text-lg font-medium">No transcription yet</p>
                  <p className="text-sm">Start recording to see live transcripts</p>
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-gray-900 dark:text-gray-100 leading-relaxed">
                    {fullText}
                  </p>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Footer Stats */}
            {segments.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span>{segments.length} segments</span>
                <span>{wordCount} words</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
          About Live Transcription
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Audio is captured in short chunks and sent to your local transcription engine.
          Results typically appear within a couple of seconds.
        </p>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <li>
            <strong>Save to Database</strong> - Persist as a recording with transcript for later access
          </li>
          <li>
            <strong>Download</strong> - Export the transcript as a plain text file
          </li>
          <li>
            <strong>Clear</strong> - Reset for a new recording session
          </li>
        </ul>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Save Recording
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="Enter a title for this recording..."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  autoFocus
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAudio}
                  onChange={(e) => setSaveAudio(e.target.checked)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Save audio recording
                </span>
              </label>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {saveAudio
                  ? 'Audio will be saved alongside the transcript. You can play it back later.'
                  : 'Only the transcript text will be saved. Audio will be discarded.'}
              </p>

              {saveError && (
                <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowSaveDialog(false); setSaveError(null); }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!saveTitle.trim() || isSaving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Recording'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
