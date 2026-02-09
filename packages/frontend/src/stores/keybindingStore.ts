/**
 * Central keybinding store — single source of truth for all customizable shortcuts.
 * Uses Zustand with localStorage persistence. Only user overrides are stored;
 * defaults are implicit and forward-compatible with new actions.
 */
import { create } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────

export interface KeyCombo {
  key: string;    // event.key value: ' ', 'k', 'ArrowLeft', 'Escape', etc.
  ctrl?: boolean; // ctrlKey || metaKey (Cmd on macOS)
  shift?: boolean;
  alt?: boolean;
}

export type ActionCategory = 'playback' | 'live';

export interface ActionDef {
  id: string;
  category: ActionCategory;
  label: string;
  defaultKey: KeyCombo;
}

// ── Default Actions ────────────────────────────────────────────────

export const DEFAULT_ACTIONS: ActionDef[] = [
  // Playback shortcuts (TranscriptPage)
  { id: 'playback.playPause',      category: 'playback', label: 'Play / Pause',       defaultKey: { key: ' ' } },
  { id: 'playback.playPauseAlt',   category: 'playback', label: 'Play / Pause (Alt)', defaultKey: { key: 'k' } },
  { id: 'playback.skipBack10',     category: 'playback', label: 'Skip back 10s',      defaultKey: { key: 'j' } },
  { id: 'playback.skipForward10',  category: 'playback', label: 'Skip forward 10s',   defaultKey: { key: 'l' } },
  { id: 'playback.skipBack5',      category: 'playback', label: 'Skip back 5s',       defaultKey: { key: 'ArrowLeft' } },
  { id: 'playback.skipForward5',   category: 'playback', label: 'Skip forward 5s',    defaultKey: { key: 'ArrowRight' } },
  { id: 'playback.prevSegment',    category: 'playback', label: 'Previous segment',   defaultKey: { key: 'ArrowUp' } },
  { id: 'playback.nextSegment',    category: 'playback', label: 'Next segment',       defaultKey: { key: 'ArrowDown' } },
  { id: 'playback.skipBack1',      category: 'playback', label: 'Skip back 1s',       defaultKey: { key: '<', shift: true } },
  { id: 'playback.skipForward1',   category: 'playback', label: 'Skip forward 1s',    defaultKey: { key: '>', shift: true } },
  { id: 'playback.goBack',         category: 'playback', label: 'Go back',            defaultKey: { key: 'Escape' } },

  // Live recording shortcuts (LiveTranscriptionPage)
  { id: 'live.toggleRecording',    category: 'live', label: 'Start / Stop recording',  defaultKey: { key: 'r' } },
  { id: 'live.toggleRecordingAlt', category: 'live', label: 'Start / Stop (Alt)',      defaultKey: { key: ' ' } },
  { id: 'live.pauseResume',        category: 'live', label: 'Pause / Resume',          defaultKey: { key: 'p' } },
  { id: 'live.save',               category: 'live', label: 'Save session',            defaultKey: { key: 's', ctrl: true } },
  { id: 'live.toggleMute',         category: 'live', label: 'Toggle mute',             defaultKey: { key: 'm' } },
  { id: 'live.discard',            category: 'live', label: 'Discard session',         defaultKey: { key: 'd' } },
  { id: 'live.clear',              category: 'live', label: 'Clear transcript',        defaultKey: { key: 'c' } },
  { id: 'live.disconnect',         category: 'live', label: 'Disconnect',              defaultKey: { key: 'Escape' } },
];

// Lookup map for fast access
const ACTION_MAP = new Map(DEFAULT_ACTIONS.map(a => [a.id, a]));

// ── Display Helpers ────────────────────────────────────────────────

const KEY_DISPLAY: Record<string, string> = {
  ' ': 'Space',
  'ArrowLeft': '\u2190',   // ←
  'ArrowRight': '\u2192',  // →
  'ArrowUp': '\u2191',     // ↑
  'ArrowDown': '\u2193',   // ↓
  'Escape': 'Esc',
};

export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) {
    // Show ⌘ on macOS, Ctrl elsewhere
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
    parts.push(isMac ? '\u2318' : 'Ctrl');
  }
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  parts.push(KEY_DISPLAY[combo.key] ?? combo.key.toUpperCase());
  return parts.join('+');
}

// ── Event Matching ─────────────────────────────────────────────────

export function matchesCombo(event: KeyboardEvent, combo: KeyCombo): boolean {
  // Key comparison: case-insensitive for letters, exact for special keys
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const comboKey = combo.key.length === 1 ? combo.key.toLowerCase() : combo.key;
  if (eventKey !== comboKey) return false;

  // Modifier matching
  const wantCtrl = !!combo.ctrl;
  const wantShift = !!combo.shift;
  const wantAlt = !!combo.alt;
  if ((event.ctrlKey || event.metaKey) !== wantCtrl) return false;
  if (event.shiftKey !== wantShift) return false;
  if (event.altKey !== wantAlt) return false;
  return true;
}

export function combosEqual(a: KeyCombo, b: KeyCombo): boolean {
  const aKey = a.key.length === 1 ? a.key.toLowerCase() : a.key;
  const bKey = b.key.length === 1 ? b.key.toLowerCase() : b.key;
  return aKey === bKey
    && !!a.ctrl === !!b.ctrl
    && !!a.shift === !!b.shift
    && !!a.alt === !!b.alt;
}

// ── Persistence ────────────────────────────────────────────────────

const STORAGE_KEY = 'verbatim-keybindings';

function loadOverrides(): Record<string, KeyCombo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Record<string, KeyCombo>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

// ── Store ──────────────────────────────────────────────────────────

interface KeybindingState {
  overrides: Record<string, KeyCombo>;
  getKey: (actionId: string) => KeyCombo;
  getDisplayLabel: (actionId: string) => string;
  setKey: (actionId: string, combo: KeyCombo) => void;
  resetKey: (actionId: string) => void;
  resetAll: () => void;
  findConflict: (combo: KeyCombo, excludeAction: string) => string | null;
}

export const useKeybindingStore = create<KeybindingState>((set, get) => ({
  overrides: loadOverrides(),

  getKey: (actionId: string): KeyCombo => {
    const override = get().overrides[actionId];
    if (override) return override;
    const def = ACTION_MAP.get(actionId);
    return def ? def.defaultKey : { key: '' };
  },

  getDisplayLabel: (actionId: string): string => {
    return formatCombo(get().getKey(actionId));
  },

  setKey: (actionId: string, combo: KeyCombo) => {
    set(state => {
      const next = { ...state.overrides, [actionId]: combo };
      saveOverrides(next);
      return { overrides: next };
    });
  },

  resetKey: (actionId: string) => {
    set(state => {
      const next = { ...state.overrides };
      delete next[actionId];
      saveOverrides(next);
      return { overrides: next };
    });
  },

  resetAll: () => {
    saveOverrides({});
    set({ overrides: {} });
  },

  findConflict: (combo: KeyCombo, excludeAction: string): string | null => {
    const excludeDef = ACTION_MAP.get(excludeAction);
    if (!excludeDef) return null;
    const category = excludeDef.category;

    for (const action of DEFAULT_ACTIONS) {
      if (action.id === excludeAction) continue;
      if (action.category !== category) continue;
      const currentCombo = get().getKey(action.id);
      if (combosEqual(currentCombo, combo)) {
        return action.id;
      }
    }
    return null;
  },
}));

// ── Shortcut List Getters (for display components) ─────────────────

export function getPlaybackShortcuts(): { key: string; description: string }[] {
  const store = useKeybindingStore.getState();
  return DEFAULT_ACTIONS
    .filter(a => a.category === 'playback')
    .map(a => ({ key: store.getDisplayLabel(a.id), description: a.label }));
}

export function getLiveShortcuts(): { key: string; description: string }[] {
  const store = useKeybindingStore.getState();
  return DEFAULT_ACTIONS
    .filter(a => a.category === 'live')
    .map(a => ({ key: store.getDisplayLabel(a.id), description: a.label }));
}
