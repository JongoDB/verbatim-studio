import { useState, useEffect } from 'react';

interface SettingsPageProps {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
}

// Languages supported by WhisperX
const LANGUAGES = [
  { code: '', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
];

const PLAYBACK_SPEEDS = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1x (Normal)' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
];

function getStoredSettings() {
  try {
    const stored = localStorage.getItem('verbatim-settings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveSettings(settings: Record<string, unknown>) {
  localStorage.setItem('verbatim-settings', JSON.stringify(settings));
}

function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-5 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="sm:max-w-md">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
        <div className="sm:w-64">{children}</div>
      </div>
    </div>
  );
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
  const [settings, setSettings] = useState(() => getStoredSettings());
  const [saved, setSaved] = useState(false);

  const defaultLanguage = settings.defaultLanguage || '';
  const defaultPlaybackSpeed = settings.defaultPlaybackSpeed || 1;
  const autoTranscribe = settings.autoTranscribe ?? false;

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const updateSetting = (key: string, value: unknown) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings(newSettings);
    setSaved(true);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure your Verbatim Studio preferences
        </p>
      </div>

      {/* Saved indicator */}
      {saved && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Settings saved
          </p>
        </div>
      )}

      {/* Appearance Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Appearance</h2>
        </div>
        <div className="px-5">
          <SettingSection
            title="Theme"
            description="Choose your preferred color scheme"
          >
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onThemeChange(t)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                    theme === t
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {t === 'light' && (
                    <svg className="w-4 h-4 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                  {t === 'dark' && (
                    <svg className="w-4 h-4 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                  {t === 'system' && (
                    <svg className="w-4 h-4 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  <span className="capitalize">{t}</span>
                </button>
              ))}
            </div>
          </SettingSection>
        </div>
      </div>

      {/* Transcription Section */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Transcription</h2>
        </div>
        <div className="px-5">
          <SettingSection
            title="Default Language"
            description="Pre-select language for new transcriptions"
          >
            <select
              value={defaultLanguage}
              onChange={(e) => updateSetting('defaultLanguage', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </SettingSection>

          <SettingSection
            title="Auto-transcribe"
            description="Automatically start transcription after upload"
          >
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoTranscribe}
                onChange={(e) => updateSetting('autoTranscribe', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
            </label>
          </SettingSection>
        </div>
      </div>

      {/* Playback Section */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Playback</h2>
        </div>
        <div className="px-5">
          <SettingSection
            title="Default Playback Speed"
            description="Set the default speed for audio playback"
          >
            <select
              value={defaultPlaybackSpeed}
              onChange={(e) => updateSetting('defaultPlaybackSpeed', parseFloat(e.target.value))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed.value} value={speed.value}>
                  {speed.label}
                </option>
              ))}
            </select>
          </SettingSection>
        </div>
      </div>

      {/* Keyboard Shortcuts Reference */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h2>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { key: 'Space / K', action: 'Play / Pause' },
              { key: 'J', action: 'Skip back 10s' },
              { key: 'L', action: 'Skip forward 10s' },
              { key: '← / →', action: 'Skip 5s' },
              { key: '↑ / ↓', action: 'Navigate segments' },
              { key: 'Esc', action: 'Go back' },
            ].map(({ key, action }) => (
              <div key={key} className="flex items-center justify-between">
                <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300">
                  {key}
                </kbd>
                <span className="text-gray-600 dark:text-gray-400">{action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">About</h2>
        </div>
        <div className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
          <p><strong>Verbatim Studio</strong> - Privacy-first transcription for professionals</p>
          <p className="mt-2">
            All processing happens locally on your machine. Your recordings and transcripts
            never leave your computer.
          </p>
        </div>
      </div>
    </div>
  );
}
