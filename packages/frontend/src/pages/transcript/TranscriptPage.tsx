import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TranscriptWithSegments, type Segment, type Speaker, type Recording } from '@/lib/api';
import { WaveformPlayer, type WaveformPlayerRef } from '@/components/audio/WaveformPlayer';
import { EditableSegment } from '@/components/transcript/EditableSegment';
import { ExportButton } from '@/components/transcript/ExportButton';
import { SpeakerPanel } from '@/components/transcript/SpeakerPanel';
import { AIAnalysisPanel } from '@/components/ai/AIAnalysisPanel';
import { useKeyboardShortcuts, KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';

interface TranscriptPageProps {
  recordingId: string;
  onBack: () => void;
  initialSeekTime?: number;
}

export function TranscriptPage({ recordingId, onBack, initialSeekTime }: TranscriptPageProps) {
  const [transcript, setTranscript] = useState<TranscriptWithSegments | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<WaveformPlayerRef>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Load transcript and recording data in parallel
      const [transcriptData, recordingData] = await Promise.all([
        api.transcripts.byRecording(recordingId),
        api.recordings.get(recordingId),
      ]);

      setTranscript(transcriptData);
      setRecording(recordingData);

      // Load speakers for this transcript
      try {
        const speakersData = await api.speakers.byTranscript(transcriptData.id);
        setSpeakers(speakersData.items);
      } catch {
        // Speakers might not exist (no diarization)
        setSpeakers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      setIsLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Seek to initial time (from search result click) once data is loaded
  const hasAppliedInitialSeek = useRef(false);
  useEffect(() => {
    if (
      initialSeekTime !== undefined &&
      !hasAppliedInitialSeek.current &&
      !isLoading &&
      transcript &&
      audioRef.current
    ) {
      hasAppliedInitialSeek.current = true;
      // Small delay to let the waveform initialize
      setTimeout(() => {
        audioRef.current?.seekTo(initialSeekTime);
      }, 500);
    }
  }, [initialSeekTime, isLoading, transcript]);

  // Handle segment text/speaker updates
  const handleSegmentUpdate = (updated: Segment) => {
    setTranscript((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        segments: prev.segments.map((s) => (s.id === updated.id ? updated : s)),
      };
    });
  };

  // Handle speaker name updates
  const handleSpeakerUpdate = (updated: Speaker) => {
    setSpeakers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  // Seek audio and start playing
  const seekTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.seekTo(time);
      audioRef.current.play();
    }
  };

  // Find active segment based on current playback time
  const activeSegmentIndex = transcript?.segments.findIndex(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  ) ?? -1;
  const activeSegmentId = activeSegmentIndex >= 0 ? transcript?.segments[activeSegmentIndex]?.id : undefined;

  // Keyboard shortcut handlers
  const handleSkipBack = useCallback((seconds = 5) => {
    if (audioRef.current) {
      const newTime = Math.max(0, currentTime - seconds);
      audioRef.current.seekTo(newTime);
    }
  }, [currentTime]);

  const handleSkipForward = useCallback((seconds = 5) => {
    if (audioRef.current) {
      audioRef.current.seekTo(currentTime + seconds);
    }
  }, [currentTime]);

  const handleNextSegment = useCallback(() => {
    if (!transcript || activeSegmentIndex < 0) return;
    const nextIndex = activeSegmentIndex + 1;
    if (nextIndex < transcript.segments.length) {
      seekTo(transcript.segments[nextIndex].start_time);
    }
  }, [transcript, activeSegmentIndex]);

  const handlePrevSegment = useCallback(() => {
    if (!transcript || activeSegmentIndex < 0) return;
    const prevIndex = activeSegmentIndex - 1;
    if (prevIndex >= 0) {
      seekTo(transcript.segments[prevIndex].start_time);
    }
  }, [transcript, activeSegmentIndex]);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onPlayPause: () => audioRef.current?.toggle(),
    onSkipBack: handleSkipBack,
    onSkipForward: handleSkipForward,
    onEscape: onBack,
    onNextSegment: handleNextSegment,
    onPrevSegment: handlePrevSegment,
    enabled: !isLoading && !!transcript,
  });

  const [showShortcuts, setShowShortcuts] = useState(false);

  // Create speaker lookup maps
  const speakerMap = new Map<string, Speaker>();
  const speakerIndexMap = new Map<string, number>();
  speakers.forEach((s, idx) => {
    speakerMap.set(s.speaker_label, s);
    speakerIndexMap.set(s.speaker_label, idx);
  });

  // Back button component (reused across states)
  const BackButton = () => (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      Back to Recordings
    </button>
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackButton />
        <div className="flex items-center justify-center py-12">
          <svg
            className="h-8 w-8 animate-spin text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <BackButton />
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
          <svg
            className="h-12 w-12 text-red-600 dark:text-red-400 mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
            Failed to Load Transcript
          </h3>
          <p className="text-sm text-red-600/80 dark:text-red-400/80">{error}</p>
          <button
            onClick={loadData}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No transcript found
  if (!transcript || !recording) {
    return (
      <div className="space-y-6">
        <BackButton />
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No transcript found for this recording.</p>
        </div>
      </div>
    );
  }

  // Transcript loaded successfully
  return (
    <div className="space-y-6">
      <BackButton />

      {/* Waveform Player - sticky at top */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 pb-4 -mx-4 px-4 pt-2 -mt-2">
        <WaveformPlayer
          ref={audioRef}
          src={api.recordings.getAudioUrl(recordingId)}
          onTimeUpdate={setCurrentTime}
        />
      </div>

      {/* Transcript info header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {recording.title}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="Keyboard shortcuts"
            >
              <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span className="hidden sm:inline">Shortcuts</span>
            </button>
            <ExportButton transcriptId={transcript.id} title={recording.title} />
          </div>
        </div>

        {/* Keyboard Shortcuts Panel */}
        {showShortcuts && (
          <div className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h4>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {KEYBOARD_SHORTCUTS.map(({ key, description }) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">
                    {key}
                  </kbd>
                  <span className="text-gray-600 dark:text-gray-400">{description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          {transcript.language && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">Language:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {transcript.language.toUpperCase()}
              </span>
            </div>
          )}
          {transcript.word_count !== null && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">Words:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {transcript.word_count.toLocaleString()}
              </span>
            </div>
          )}
          {transcript.model_used && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">Model:</span>
              <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-700 dark:text-gray-300">
                {transcript.model_used}
              </span>
            </div>
          )}
          {speakers.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">Speakers:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {speakers.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Speaker Statistics Panel */}
      {speakers.length > 0 && (
        <SpeakerPanel
          speakers={speakers}
          segments={transcript.segments}
          onSpeakerUpdate={handleSpeakerUpdate}
        />
      )}

      {/* AI Analysis Panel */}
      <AIAnalysisPanel transcriptId={transcript.id} />

      {/* Editable Segments */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
          {transcript.segments.length} segment{transcript.segments.length !== 1 ? 's' : ''}
        </h3>
        <div className="space-y-2">
          {transcript.segments.map((segment) => {
            const speaker = segment.speaker ? speakerMap.get(segment.speaker) ?? null : null;
            const speakerIndex = segment.speaker ? (speakerIndexMap.get(segment.speaker) ?? 0) : 0;

            return (
              <EditableSegment
                key={segment.id}
                segment={segment}
                transcriptId={transcript.id}
                speaker={speaker}
                speakerIndex={speakerIndex}
                isActive={segment.id === activeSegmentId}
                onSegmentUpdate={handleSegmentUpdate}
                onSpeakerUpdate={handleSpeakerUpdate}
                onSeek={seekTo}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
