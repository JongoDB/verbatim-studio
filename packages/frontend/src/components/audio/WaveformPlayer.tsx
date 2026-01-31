import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface WaveformPlayerProps {
  src: string;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  onReady?: () => void;
}

export interface WaveformPlayerRef {
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
}

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(
  function WaveformPlayer({ src, onTimeUpdate, onDurationChange, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);

    // Expose control methods via ref
    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (wavesurferRef.current && duration > 0) {
          wavesurferRef.current.seekTo(time / duration);
        }
      },
      play: () => {
        wavesurferRef.current?.play();
      },
      pause: () => {
        wavesurferRef.current?.pause();
      },
      toggle: () => {
        wavesurferRef.current?.playPause();
      },
    }), [duration]);

    // Initialize WaveSurfer
    useEffect(() => {
      if (!containerRef.current) return;

      // Track if component is still mounted
      let isMounted = true;

      // Get theme state for colors
      const isDark = document.documentElement.classList.contains('dark');

      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: isDark ? '#64748b' : '#94a3b8',
        progressColor: isDark ? '#3b82f6' : '#2563eb',
        cursorColor: isDark ? '#f97316' : '#ea580c',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 64,
        normalize: true,
        // Use url option - WaveSurfer will fetch and decode for waveform
        url: src,
      });

      wavesurferRef.current = wavesurfer;

      // Event handlers
      wavesurfer.on('ready', () => {
        if (!isMounted) return;
        setIsLoading(false);
        const dur = wavesurfer.getDuration();
        setDuration(dur);
        onDurationChange?.(dur);
        onReady?.();
      });

      wavesurfer.on('play', () => isMounted && setIsPlaying(true));
      wavesurfer.on('pause', () => isMounted && setIsPlaying(false));
      wavesurfer.on('finish', () => isMounted && setIsPlaying(false));

      wavesurfer.on('timeupdate', (time) => {
        if (!isMounted) return;
        setCurrentTime(time);
        onTimeUpdate?.(time);
      });

      wavesurfer.on('error', (err) => {
        // Ignore abort errors from unmounting
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('WaveSurfer error:', err);
        if (isMounted) setIsLoading(false);
      });

      return () => {
        isMounted = false;
        wavesurfer.destroy();
      };
    }, [src]); // Only recreate when src changes

    // Update colors when theme changes
    useEffect(() => {
      const observer = new MutationObserver(() => {
        if (wavesurferRef.current) {
          const isDark = document.documentElement.classList.contains('dark');
          wavesurferRef.current.setOptions({
            waveColor: isDark ? '#64748b' : '#94a3b8',
            progressColor: isDark ? '#3b82f6' : '#2563eb',
            cursorColor: isDark ? '#f97316' : '#ea580c',
          });
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      return () => observer.disconnect();
    }, []);

    // Update callback refs
    useEffect(() => {
      const ws = wavesurferRef.current;
      if (!ws) return;

      const handleTimeUpdate = (time: number) => {
        setCurrentTime(time);
        onTimeUpdate?.(time);
      };

      ws.on('timeupdate', handleTimeUpdate);
      return () => {
        ws.un('timeupdate', handleTimeUpdate);
      };
    }, [onTimeUpdate]);

    const togglePlay = useCallback(() => {
      wavesurferRef.current?.playPause();
    }, []);

    const changePlaybackRate = useCallback((rate: number) => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setPlaybackRate(rate);
        setPlaybackRate(rate);
      }
    }, []);

    const formatTime = (seconds: number) => {
      if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
        {/* Controls row */}
        <div className="flex items-center gap-4 mb-3">
          {/* Play/Pause button */}
          <button
            onClick={togglePlay}
            disabled={isLoading}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Time display */}
          <span className="text-sm font-mono text-gray-600 dark:text-gray-300 min-w-[100px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Playback rate */}
          <select
            value={playbackRate}
            onChange={(e) => changePlaybackRate(parseFloat(e.target.value))}
            className="text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Playback speed"
          >
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
        </div>

        {/* Waveform container */}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded">
              <span className="text-sm text-gray-500 dark:text-gray-400">Loading waveform...</span>
            </div>
          )}
          <div ref={containerRef} className="w-full" />
        </div>
      </div>
    );
  }
);
