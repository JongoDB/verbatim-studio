import { useEffect, useCallback } from 'react';
import { useKeybindingStore, matchesCombo } from '@/stores/keybindingStore';

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
  const getKey = useKeybindingStore(s => s.getKey);

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

      if (matchesCombo(event, getKey('live.toggleRecording')) ||
          matchesCombo(event, getKey('live.toggleRecordingAlt'))) {
        event.preventDefault();
        onToggleRecording?.();
      } else if (matchesCombo(event, getKey('live.pauseResume'))) {
        event.preventDefault();
        onPauseResume?.();
      } else if (matchesCombo(event, getKey('live.save'))) {
        event.preventDefault();
        onSave?.();
      } else if (matchesCombo(event, getKey('live.toggleMute'))) {
        event.preventDefault();
        onToggleMute?.();
      } else if (matchesCombo(event, getKey('live.discard'))) {
        event.preventDefault();
        onDiscard?.();
      } else if (matchesCombo(event, getKey('live.clear'))) {
        event.preventDefault();
        onClear?.();
      } else if (matchesCombo(event, getKey('live.disconnect'))) {
        onDisconnect?.();
      }
    },
    [onToggleRecording, onPauseResume, onSave, onToggleMute, onDiscard, onClear, onDisconnect, getKey],
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// Re-export for display components
export { getLiveShortcuts } from '@/stores/keybindingStore';
