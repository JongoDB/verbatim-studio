import { useEffect, useCallback } from 'react';
import { useKeybindingStore, matchesCombo } from '@/stores/keybindingStore';

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
  const getKey = useKeybindingStore(s => s.getKey);

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

      if (matchesCombo(event, getKey('playback.playPause')) ||
          matchesCombo(event, getKey('playback.playPauseAlt'))) {
        event.preventDefault();
        onPlayPause?.();
      } else if (matchesCombo(event, getKey('playback.skipBack10'))) {
        event.preventDefault();
        onSkipBack?.(10);
      } else if (matchesCombo(event, getKey('playback.skipForward10'))) {
        event.preventDefault();
        onSkipForward?.(10);
      } else if (matchesCombo(event, getKey('playback.skipBack5'))) {
        event.preventDefault();
        onSkipBack?.(SKIP_SECONDS);
      } else if (matchesCombo(event, getKey('playback.skipForward5'))) {
        event.preventDefault();
        onSkipForward?.(SKIP_SECONDS);
      } else if (matchesCombo(event, getKey('playback.prevSegment'))) {
        event.preventDefault();
        onPrevSegment?.();
      } else if (matchesCombo(event, getKey('playback.nextSegment'))) {
        event.preventDefault();
        onNextSegment?.();
      } else if (matchesCombo(event, getKey('playback.goBack'))) {
        onEscape?.();
      }
    },
    [onPlayPause, onSkipBack, onSkipForward, onEscape, onNextSegment, onPrevSegment, getKey]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// Re-export for display components
export { getPlaybackShortcuts } from '@/stores/keybindingStore';
