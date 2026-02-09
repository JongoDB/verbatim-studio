// packages/frontend/src/hooks/useLiveTranscription.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { getWebSocketUrl, getApiUrl } from '@/lib/api';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'recording' | 'paused';

export interface WordData {
  word: string;
  start: number;
  end: number;
  confidence: number | null;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  chunkIndex: number;
  speaker?: string | null;
  confidence?: number | null;
  words?: WordData[] | null;
  edited?: boolean;
}

export interface LiveError {
  type: string;
  message: string;
  retryable: boolean;
}

export interface UseLiveTranscriptionReturn {
  connectionState: ConnectionState;
  sessionId: string | null;
  segments: TranscriptSegment[];
  duration: number;
  error: LiveError | null;
  lastAutoSave: Date | null;
  fullText: string;
  wordCount: number;
  isMuted: boolean;
  highDetailMode: boolean;
  stream: MediaStream | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startRecording: (language: string, highDetail?: boolean) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  toggleMute: () => void;
  updateSegmentText: (index: number, newText: string) => void;
  clearTranscript: () => Promise<void>;
  dismissError: () => void;
}

// Chunk interval in milliseconds (1.5 seconds for lower latency)
const CHUNK_INTERVAL_MS = 1500;

// Auto-save interval in milliseconds (30 seconds)
const AUTOSAVE_INTERVAL_MS = 30_000;

// Reconnection settings
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

// Allow time for final chunk processing: chunk interval + backend processing buffer
const FINAL_CHUNK_WAIT_MS = CHUNK_INTERVAL_MS + 1000;

export function useLiveTranscription(): UseLiveTranscriptionReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<LiveError | null>(null);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [highDetailMode, setHighDetailMode] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunkIntervalRef = useRef<number | null>(null);
  const autosaveIntervalRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Keep ref in sync for use in callbacks
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Shared cleanup — stops all timers, media, and WebSocket
  const cleanup = useCallback((sendDisconnect = false) => {
    isRecordingRef.current = false;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
    if (autosaveIntervalRef.current) { clearInterval(autosaveIntervalRef.current); autosaveIntervalRef.current = null; }
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (sendDisconnect) {
        wsRef.current.send(JSON.stringify({ type: 'disconnect' }));
      }
      wsRef.current.close();
    }
    setIsMuted(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  const startAutosave = useCallback(() => {
    if (autosaveIntervalRef.current) {
      clearInterval(autosaveIntervalRef.current);
      autosaveIntervalRef.current = null;
    }
    autosaveIntervalRef.current = window.setInterval(async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await fetch(getApiUrl('/api/live/autosave'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        });
        setLastAutoSave(new Date());
      } catch {
        // Autosave is best-effort, don't interrupt recording
      }
    }, AUTOSAVE_INTERVAL_MS);
  }, []);

  const stopAutosave = useCallback(() => {
    if (autosaveIntervalRef.current) {
      clearInterval(autosaveIntervalRef.current);
      autosaveIntervalRef.current = null;
    }
  }, []);

  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (data.type) {
      case 'ready':
        reconnectAttemptsRef.current = 0;
        break;

      case 'session_start':
        setSessionId(data.session_id as string);
        break;

      case 'transcript':
        setSegments(prev => [...prev, {
          text: data.text as string,
          start: data.start as number,
          end: data.end as number,
          chunkIndex: data.chunk_index as number,
          speaker: (data.speaker as string) ?? null,
          confidence: (data.confidence as number) ?? null,
          words: (data.words as WordData[]) ?? null,
          edited: false,
        }]);
        break;

      case 'session_end':
        break;

      case 'error':
        setError({
          type: (data.error_type as string) || 'unknown',
          message: data.message as string,
          retryable: (data.retryable as boolean) ?? false,
        });
        break;

      case 'pong':
        break;
    }
  }, []);

  // Unified WebSocket creation — used by both connect() and reconnect
  const createWebSocket = useCallback((onInitialError?: () => void) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = getWebSocketUrl('/api/live/transcribe');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = handleWebSocketMessage;

    ws.onerror = () => {
      if (onInitialError) {
        onInitialError();
      }
    };

    ws.onclose = () => {
      if (isRecordingRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
          30_000
        );
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(() => createWebSocket(), delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError({
          type: 'connection',
          message: 'Connection lost. Please reconnect manually.',
          retryable: false,
        });
        setConnectionState('disconnected');
      } else {
        setConnectionState('disconnected');
      }
    };

    return ws;
  }, [handleWebSocketMessage]);

  const connect = useCallback(async () => {
    setError(null);
    setConnectionState('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      createWebSocket(() => {
        setError({
          type: 'connection',
          message: 'Failed to connect to transcription server.',
          retryable: true,
        });
        setConnectionState('disconnected');
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect';
      const isMicError = msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('getUserMedia');
      setError({
        type: isMicError ? 'microphone' : 'connection',
        message: isMicError
          ? 'Microphone access denied. Please allow microphone access and try again.'
          : msg,
        retryable: !isMicError,
      });
      setConnectionState('disconnected');
    }
  }, [createWebSocket]);

  const disconnect = useCallback(() => {
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
    cleanup(true);
    setConnectionState('disconnected');
  }, [cleanup]);

  // Create a new MediaRecorder and start recording a chunk
  const startNewChunk = useCallback(() => {
    if (!streamRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: 'audio/webm;codecs=opus',
    });
    mediaRecorderRef.current = mediaRecorder;

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (chunks.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
        wsRef.current.send(blob);
      }
    };

    mediaRecorder.start();
  }, []);

  // Shared helper: start chunk cycling + duration timer
  const startRecordingTimers = useCallback(() => {
    startNewChunk();

    chunkIntervalRef.current = window.setInterval(() => {
      if (!isRecordingRef.current) return;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      startNewChunk();
    }, CHUNK_INTERVAL_MS);

    timerRef.current = window.setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);
  }, [startNewChunk]);

  // Shared helper: stop chunk cycling + duration timer
  const stopRecordingTimers = useCallback(() => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback((language: string, highDetail = false) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError({ type: 'connection', message: 'Not connected to server.', retryable: true });
      return;
    }
    if (!streamRef.current) {
      setError({ type: 'microphone', message: 'No microphone stream available.', retryable: false });
      return;
    }

    setHighDetailMode(highDetail);
    wsRef.current.send(JSON.stringify({ type: 'start', language, high_detail_mode: highDetail }));
    isRecordingRef.current = true;

    startRecordingTimers();
    setConnectionState('recording');
    setDuration(0);

    startAutosave();
  }, [startRecordingTimers, startAutosave]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;

    stopRecordingTimers();
    stopAutosave();

    // Wait for final chunk to be transcribed before ending session
    setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
    }, FINAL_CHUNK_WAIT_MS);

    setConnectionState('connected');
  }, [stopRecordingTimers, stopAutosave]);

  // Pause: stop chunk cycling, keep WS alive
  const pauseRecording = useCallback(() => {
    stopRecordingTimers();
    setConnectionState('paused');
  }, [stopRecordingTimers]);

  // Resume: restart chunk cycling and duration timer
  const resumeRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    if (!streamRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    startRecordingTimers();
    setConnectionState('recording');
  }, [startRecordingTimers]);

  // Mute: disable audio tracks (backend receives silence)
  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    const audioTracks = streamRef.current.getAudioTracks();
    const newMuted = !isMuted;
    audioTracks.forEach(track => { track.enabled = !newMuted; });
    setIsMuted(newMuted);
  }, [isMuted]);

  // Edit a segment's text before saving
  const updateSegmentText = useCallback((index: number, newText: string) => {
    setSegments(prev => prev.map((seg, i) =>
      i === index ? { ...seg, text: newText, edited: true } : seg
    ));
  }, []);

  const clearTranscript = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(getApiUrl(`/api/live/session/${sessionId}`), {
          method: 'DELETE',
        });
      } catch {
        // Ignore — session might already be gone
      }
    }
    setSegments([]);
    setSessionId(null);
    setDuration(0);
    setLastAutoSave(null);
  }, [sessionId]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const fullText = segments.map(s => s.text).join(' ');
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  return {
    connectionState,
    sessionId,
    segments,
    duration,
    error,
    lastAutoSave,
    fullText,
    wordCount,
    isMuted,
    highDetailMode,
    stream: streamRef.current,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    toggleMute,
    updateSegmentText,
    clearTranscript,
    dismissError,
  };
}
