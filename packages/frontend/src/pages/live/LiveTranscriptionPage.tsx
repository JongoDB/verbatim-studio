import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiUrl } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useLiveTranscription } from '@/hooks/useLiveTranscription';
import { useLiveShortcuts, LIVE_SHORTCUTS } from '@/hooks/useLiveShortcuts';
import { AudioLevelMeter } from '@/components/audio/AudioLevelMeter';
import { LiveSegment } from '@/components/live/LiveSegment';
import { MetadataPanel, type LiveMetadata } from '@/components/live/MetadataPanel';

interface LiveTranscriptionPageProps {
  onNavigateToRecordings: () => void;
  onViewRecording: (recordingId: string) => void;
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

const DEFAULT_METADATA: LiveMetadata = {
  title: '',
  projectId: null,
  tags: [],
  description: '',
  saveAudio: true,
};

export function LiveTranscriptionPage({ onNavigateToRecordings: _onNavigateToRecordings, onViewRecording }: LiveTranscriptionPageProps) {
  const {
    connectionState,
    sessionId,
    segments,
    duration,
    error,
    lastAutoSave,
    wordCount,
    isMuted,
    highDetailMode,
    stream,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    toggleMute,
    updateSegmentText,
    deleteSegment,
    clearTranscript,
    dismissError,
  } = useLiveTranscription();

  const [language, setLanguage] = useState('en');
  const [highDetail, setHighDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<LiveMetadata>(DEFAULT_METADATA);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isEditingSegment, setIsEditingSegment] = useState(false);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const isActive = connectionState === 'recording' || connectionState === 'paused';

  // Auto-scroll to bottom when new segments arrive (paused during editing)
  useEffect(() => {
    if (!isEditingSegment) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [segments, isEditingSegment]);

  const handleStartRecording = useCallback(() => {
    startRecording(language, highDetail);
  }, [startRecording, language, highDetail]);

  const handleToggleRecording = useCallback(() => {
    if (connectionState === 'recording' || connectionState === 'paused') {
      stopRecording();
    } else if (connectionState === 'connected') {
      handleStartRecording();
    }
  }, [connectionState, stopRecording, handleStartRecording]);

  const handlePauseResume = useCallback(() => {
    if (connectionState === 'recording') {
      pauseRecording();
    } else if (connectionState === 'paused') {
      resumeRecording();
    }
  }, [connectionState, pauseRecording, resumeRecording]);

  const downloadTranscript = useCallback(() => {
    const text = segments.map(s => {
      const prefix = s.speaker ? `[${s.speaker}] ` : '';
      return `${prefix}${s.text}`;
    }).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `live-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [segments]);

  const handleSave = useCallback(async () => {
    if (!sessionId) return;

    const title = metadata.title.trim() || `Live Recording ${new Date().toLocaleDateString()}`;

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(getApiUrl('/api/live/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          title,
          save_audio: metadata.saveAudio,
          project_id: metadata.projectId,
          tags: metadata.tags,
          description: metadata.description || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save session');
      }

      const data = await response.json();
      setShowSaveConfirm(false);
      setMetadata(DEFAULT_METADATA);

      // Navigate first, then clean up state (save already deleted the session)
      onViewRecording(data.recording_id);
      clearTranscript();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, metadata, clearTranscript, onViewRecording]);

  const handleSaveClick = useCallback(() => {
    if (segments.length === 0 || !sessionId) return;
    setShowSaveConfirm(true);
  }, [segments, sessionId]);

  // Keyboard shortcuts
  useLiveShortcuts({
    onToggleRecording: handleToggleRecording,
    onPauseResume: handlePauseResume,
    onSave: handleSaveClick,
    onToggleMute: toggleMute,
    onDiscard: () => {
      if (segments.length > 0 && sessionId) {
        clearTranscript();
      }
    },
    onClear: () => {
      if (segments.length > 0) {
        clearTranscript();
      }
    },
    onDisconnect: () => {
      if (connectionState !== 'disconnected') {
        disconnect();
      }
    },
    enabled: connectionState !== 'disconnected' && !showSaveConfirm,
  });

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
        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
            showShortcuts
              ? 'text-purple-600 dark:text-purple-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
          title="Keyboard shortcuts"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Shortcuts
        </button>
      </div>

      {/* Keyboard Shortcuts Panel */}
      {showShortcuts && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LIVE_SHORTCUTS.map(s => (
              <div key={s.key} className="flex items-center gap-2 text-xs">
                <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono">{s.key}</kbd>
                <span className="text-gray-600 dark:text-gray-400">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error / Warning Banner */}
      {error && (
        <div className={`p-4 rounded-lg border ${
          error.type === 'warning'
            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
            : error.retryable
              ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        }`}>
          <div className={`flex items-center gap-2 ${
            error.type === 'warning'
              ? 'text-blue-700 dark:text-blue-400'
              : error.retryable
                ? 'text-yellow-700 dark:text-yellow-400'
                : 'text-red-700 dark:text-red-400'
          }`}>
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              {error.type === 'warning' ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              )}
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
                connectionState === 'paused' ? 'bg-yellow-400' :
                'bg-red-400 animate-pulse'
              }`} />
              <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                {connectionState === 'recording' ? 'Recording' :
                 connectionState === 'paused' ? 'Paused' :
                 connectionState}
              </span>
              {isMuted && isActive && (
                <span className="text-xs text-red-500 font-medium ml-1">(Muted)</span>
              )}
            </div>

            {/* Language Selection */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isActive}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>

            {/* High Detail Mode toggle */}
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={highDetail}
                onChange={(e) => setHighDetail(e.target.checked)}
                disabled={isActive}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                High detail mode
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400" title="Enables speaker diarization and word-level confidence. Slower but more detailed.">
                ?
              </span>
            </label>

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
            <div className="text-4xl font-mono font-bold text-center text-gray-900 dark:text-gray-100 mb-2">
              {formatDuration(duration)}
            </div>

            {/* Audio Level Meter */}
            {isActive && (
              <div className="mb-4">
                <AudioLevelMeter stream={stream} isActive={isActive && !isMuted} />
              </div>
            )}

            {/* Record / Stop / Pause buttons */}
            {isActive ? (
              <div className="flex gap-2">
                {/* Pause/Resume */}
                <button
                  onClick={handlePauseResume}
                  className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
                >
                  {connectionState === 'paused' ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Resume
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                      Pause
                    </>
                  )}
                </button>

                {/* Mute */}
                <button
                  onClick={toggleMute}
                  className={`px-3 py-3 rounded-lg border transition-colors ${
                    isMuted
                      ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>

                {/* Stop */}
                <button
                  onClick={stopRecording}
                  className="flex-1 py-3 rounded-lg bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors flex items-center justify-center gap-2"
                >
                  <span className="w-3 h-3 rounded-sm bg-white" />
                  Stop
                </button>
              </div>
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
            {lastAutoSave && isActive && (
              <p className="mt-2 text-xs text-center text-green-600 dark:text-green-400">
                Auto-saved {lastAutoSave.toLocaleTimeString()}
              </p>
            )}

            {/* High detail badge */}
            {highDetailMode && isActive && (
              <p className="mt-2 text-xs text-center text-purple-600 dark:text-purple-400">
                High detail: speakers + word confidence
              </p>
            )}

            {/* Compact shortcut hints */}
            {connectionState !== 'disconnected' && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
                <div className="flex justify-between"><span><kbd className="font-mono">Space</kbd> Start/Stop</span><span><kbd className="font-mono">P</kbd> Pause</span></div>
                <div className="flex justify-between"><span><kbd className="font-mono">M</kbd> Mute</span><span><kbd className="font-mono">⌘S</kbd> Save</span></div>
              </div>
            )}
          </div>

          {/* Metadata Panel */}
          <MetadataPanel
            metadata={metadata}
            onChange={setMetadata}
            disabled={isSaving}
          />
        </div>

        {/* Right Panel - Transcript */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 h-full flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Transcript</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSaveClick}
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
                  onClick={() => clearTranscript()}
                  disabled={segments.length === 0}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Transcript Content — Segment-based display */}
            <div
              className="flex-1 p-3 overflow-y-auto min-h-[400px] max-h-[600px]"
              onFocusCapture={() => setIsEditingSegment(true)}
              onBlurCapture={() => setIsEditingSegment(false)}
            >
              {segments.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                  <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p className="text-lg font-medium">No transcription yet</p>
                  <p className="text-sm">Start recording to see live transcripts</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {segments.map((seg, i) => (
                    <LiveSegment
                      key={`${i}-${seg.start}`}
                      segment={seg}
                      index={i}
                      onEditText={updateSegmentText}
                      onDelete={deleteSegment}
                      showTimestamps={true}
                      showConfidence={highDetailMode}
                    />
                  ))}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Footer Stats */}
            {segments.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-4">
                  <span>{segments.length} segments</span>
                  <span>{wordCount} words</span>
                  {segments.some(s => s.edited) && (
                    <span className="text-purple-500">Edited</span>
                  )}
                </div>
                {highDetailMode && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">Confidence:</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700" /> Uncertain</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700" /> Low</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save Confirmation Dialog */}
      {showSaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Save Recording
            </h3>

            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Save <strong>{segments.length} segments</strong> ({wordCount} words) as a recording?
              </p>

              {!metadata.title.trim() && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No title set — will be saved as "Live Recording {new Date().toLocaleDateString()}"
                </p>
              )}

              {metadata.title.trim() && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Title: <strong>{metadata.title}</strong>
                </p>
              )}

              {metadata.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metadata.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {saveError && (
                <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowSaveConfirm(false); setSaveError(null); }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
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
