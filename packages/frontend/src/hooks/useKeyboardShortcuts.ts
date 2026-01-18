import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsConfig {
  onPlayPause?: () => void;
  onSkipBack?: (seconds?: number) => void;
  onSkipForward?: (seconds?: number) => void;
  onEscape?: () => void;
  onNextSegment?: () => void;
  onPrevSegment?: () => void;
  enabled?: boolean;
}

const SKIP_SECONDS = 5;

export function useKeyboardShortcuts({
  onPlayPause,
  onSkipBack,
  onSkipForward,
  onEscape,
  onNextSegment,
  onPrevSegment,
  enabled = true,
}: KeyboardShortcutsConfig) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input field
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Map of key -> action
      switch (event.key) {
        case ' ':
          // Space: Play/Pause
          event.preventDefault();
          onPlayPause?.();
          break;

        case 'k':
        case 'K':
          // K: Play/Pause (YouTube-style)
          event.preventDefault();
          onPlayPause?.();
          break;

        case 'j':
        case 'J':
          // J: Skip back 10 seconds (YouTube-style)
          event.preventDefault();
          onSkipBack?.(10);
          break;

        case 'l':
        case 'L':
          // L: Skip forward 10 seconds (YouTube-style)
          event.preventDefault();
          onSkipForward?.(10);
          break;

        case 'ArrowLeft':
          // Left arrow: Skip back 5 seconds
          event.preventDefault();
          onSkipBack?.(SKIP_SECONDS);
          break;

        case 'ArrowRight':
          // Right arrow: Skip forward 5 seconds
          event.preventDefault();
          onSkipForward?.(SKIP_SECONDS);
          break;

        case 'ArrowUp':
          // Up arrow: Previous segment
          event.preventDefault();
          onPrevSegment?.();
          break;

        case 'ArrowDown':
          // Down arrow: Next segment
          event.preventDefault();
          onNextSegment?.();
          break;

        case 'Escape':
          // Escape: Go back / close dialog
          onEscape?.();
          break;

        case ',':
          // Comma: Frame back (small skip)
          if (event.shiftKey) {
            event.preventDefault();
            onSkipBack?.(1);
          }
          break;

        case '.':
          // Period: Frame forward (small skip)
          if (event.shiftKey) {
            event.preventDefault();
            onSkipForward?.(1);
          }
          break;
      }
    },
    [onPlayPause, onSkipBack, onSkipForward, onEscape, onNextSegment, onPrevSegment]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// Keyboard shortcuts help text
export const KEYBOARD_SHORTCUTS = [
  { key: 'Space', description: 'Play / Pause' },
  { key: 'K', description: 'Play / Pause' },
  { key: 'J', description: 'Skip back 10s' },
  { key: 'L', description: 'Skip forward 10s' },
  { key: '←', description: 'Skip back 5s' },
  { key: '→', description: 'Skip forward 5s' },
  { key: '↑', description: 'Previous segment' },
  { key: '↓', description: 'Next segment' },
  { key: 'Shift + <', description: 'Skip back 1s' },
  { key: 'Shift + >', description: 'Skip forward 1s' },
  { key: 'Esc', description: 'Go back' },
] as const;
