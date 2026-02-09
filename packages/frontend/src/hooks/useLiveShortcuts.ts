import { useEffect, useCallback } from 'react';

interface LiveShortcutsConfig {
  onPauseResume?: () => void;
  onToggleRecording?: () => void;
  onSave?: () => void;
  onToggleMute?: () => void;
  onDiscard?: () => void;
  onClear?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

export function useLiveShortcuts({
  onPauseResume,
  onToggleRecording,
  onSave,
  onToggleMute,
  onDiscard,
  onClear,
  onDisconnect,
  enabled = true,
}: LiveShortcutsConfig) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'r':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onToggleRecording?.();
          }
          break;

        case 'p':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onPauseResume?.();
          }
          break;

        case ' ':
          event.preventDefault();
          onToggleRecording?.();
          break;

        case 's':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            onSave?.();
          }
          break;

        case 'm':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onToggleMute?.();
          }
          break;

        case 'd':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onDiscard?.();
          }
          break;

        case 'c':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onClear?.();
          }
          break;

        case 'escape':
          onDisconnect?.();
          break;
      }
    },
    [onToggleRecording, onPauseResume, onSave, onToggleMute, onDiscard, onClear, onDisconnect],
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

export const LIVE_SHORTCUTS = [
  { key: 'R / Space', description: 'Start / Stop recording' },
  { key: 'P', description: 'Pause / Resume recording' },
  { key: 'Ctrl+S', description: 'Save session' },
  { key: 'M', description: 'Toggle microphone mute' },
  { key: 'D', description: 'Discard session' },
  { key: 'C', description: 'Clear transcript' },
  { key: 'Esc', description: 'Disconnect' },
] as const;
