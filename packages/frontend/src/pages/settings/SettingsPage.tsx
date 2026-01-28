import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type ArchiveInfo, type TranscriptionSettings } from '@/lib/api';

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

  // Backup/restore state
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Transcription settings
  const [txSettings, setTxSettings] = useState<TranscriptionSettings | null>(null);
  const [txSaving, setTxSaving] = useState(false);
  const [txSaved, setTxSaved] = useState(false);
  const [showHfToken, setShowHfToken] = useState(false);
  const [hfTokenInput, setHfTokenInput] = useState('');

  const defaultLanguage = settings.defaultLanguage || '';
  const defaultPlaybackSpeed = settings.defaultPlaybackSpeed || 1;
  const autoTranscribe = settings.autoTranscribe ?? false;

  // Load archive info, config status, and transcription settings
  useEffect(() => {
    api.archive.info().then(setArchiveInfo).catch(console.error);
    api.config.getTranscription().then(setTxSettings).catch(console.error);
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const url = api.archive.exportUrl(true);
      window.location.href = url;
    } finally {
      setTimeout(() => setIsExporting(false), 1000);
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await api.archive.import(file, true);
      setImportResult({
        success: result.errors.length === 0,
        message: `Imported ${result.recordings_imported} recordings, ${result.transcripts_imported} transcripts, ${result.projects_imported} projects` +
          (result.errors.length > 0 ? `. ${result.errors.length} errors.` : '.'),
      });
      // Refresh archive info
      const info = await api.archive.info();
      setArchiveInfo(info);
    } catch (err) {
      setImportResult({
        success: false,
        message: err instanceof Error ? err.message : 'Import failed',
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  useEffect(() => {
    if (txSaved) {
      const timer = setTimeout(() => setTxSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [txSaved]);

  const updateTxSetting = useCallback(async (field: string, value: string | number | boolean) => {
    setTxSaving(true);
    try {
      const updated = await api.config.updateTranscription({ [field]: value });
      setTxSettings(updated);
      setTxSaved(true);
    } catch (err) {
      console.error('Failed to save transcription setting:', err);
    } finally {
      setTxSaving(false);
    }
  }, []);

  const applyPreset = useCallback(async (presetKey: string) => {
    if (!txSettings) return;
    const preset = txSettings.presets[presetKey];
    if (!preset) return;
    setTxSaving(true);
    try {
      const updated = await api.config.updateTranscription({
        model: preset.model,
        compute_type: preset.compute_type,
        batch_size: preset.batch_size,
      });
      setTxSettings(updated);
      setTxSaved(true);
    } catch (err) {
      console.error('Failed to apply preset:', err);
    } finally {
      setTxSaving(false);
    }
  }, [txSettings]);

  const saveHfToken = useCallback(async () => {
    setTxSaving(true);
    try {
      const updated = await api.config.updateTranscription({ hf_token: hfTokenInput });
      setTxSettings(updated);
      setHfTokenInput('');
      setTxSaved(true);
    } catch (err) {
      console.error('Failed to save HF token:', err);
    } finally {
      setTxSaving(false);
    }
  }, [hfTokenInput]);

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

      {/* WhisperX Configuration */}
      {txSettings && (
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">WhisperX Engine</h2>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                txSettings.mode === 'external'
                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              }`}>
                {txSettings.mode === 'external' ? 'External Service' : 'Local Processing'}
              </span>
            </div>
            {txSaved && (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
            {txSaving && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            )}
          </div>
          <div className="px-5 py-4 space-y-5">
            {/* Presets */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Presets</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { key: 'fast', label: 'Fast', desc: 'tiny / int8 / 32' },
                  { key: 'balanced', label: 'Balanced', desc: 'base / int8 / 16' },
                  { key: 'accurate', label: 'Accurate', desc: 'large-v3 / fp16 / 8' },
                  { key: 'cpu_only', label: 'CPU Only', desc: 'base / int8 / 8' },
                ] as const).map((preset) => {
                  const p = txSettings.presets[preset.key];
                  const isActive = p && txSettings.model === p.model && txSettings.compute_type === p.compute_type && txSettings.batch_size === p.batch_size;
                  return (
                    <button
                      key={preset.key}
                      onClick={() => applyPreset(preset.key)}
                      disabled={txSaving}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500'
                          : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      } disabled:opacity-50`}
                    >
                      <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
                        {preset.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{preset.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model, Device, Compute Type, Batch Size dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
                <select
                  value={txSettings.model}
                  onChange={(e) => updateTxSetting('model', e.target.value)}
                  disabled={txSaving}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {txSettings.available_models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Larger models are more accurate but slower</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Device</label>
                <select
                  value={txSettings.device}
                  onChange={(e) => updateTxSetting('device', e.target.value)}
                  disabled={txSaving}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {txSettings.available_devices.map((d) => (
                    <option key={d} value={d}>{d === 'mps' ? 'mps (Apple Silicon)' : d === 'cuda' ? 'cuda (NVIDIA GPU)' : d}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Auto-detected from your hardware</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Compute Type</label>
                <select
                  value={txSettings.compute_type}
                  onChange={(e) => updateTxSetting('compute_type', e.target.value)}
                  disabled={txSaving}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {txSettings.available_compute_types.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">int8 is fastest, float16 for GPU, float32 most precise</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Batch Size</label>
                <select
                  value={txSettings.batch_size}
                  onChange={(e) => updateTxSetting('batch_size', parseInt(e.target.value, 10))}
                  disabled={txSaving}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {txSettings.available_batch_sizes.map((bs) => (
                    <option key={bs} value={bs}>{bs}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Higher = faster but uses more memory</p>
              </div>
            </div>

            {/* Speaker Diarization toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Speaker Diarization</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Identify and label different speakers in the transcript</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={txSettings.diarize}
                  onChange={(e) => updateTxSetting('diarize', e.target.checked)}
                  disabled={txSaving}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
              </label>
            </div>

            {/* HuggingFace Token */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">HuggingFace Token</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Required for speaker diarization. Get a token from{' '}
                <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                  huggingface.co/settings/tokens
                </a>
                {' '}and accept the{' '}
                <a href="https://huggingface.co/pyannote/speaker-diarization-3.1" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                  pyannote model license
                </a>
                .
              </p>
              {txSettings.hf_token_set && !hfTokenInput && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Token configured ({txSettings.hf_token_masked})
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showHfToken ? 'text' : 'password'}
                    value={hfTokenInput}
                    onChange={(e) => setHfTokenInput(e.target.value)}
                    placeholder={txSettings.hf_token_set ? 'Enter new token to replace...' : 'hf_...'}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 pr-10 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowHfToken(!showHfToken)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showHfToken ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <button
                  onClick={saveHfToken}
                  disabled={!hfTokenInput.trim() || txSaving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Save
                </button>
              </div>
            </div>

            {/* External URL info */}
            {txSettings.external_url && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-sm">
                <div className="text-purple-700 dark:text-purple-300">
                  External WhisperX URL: <span className="font-mono text-xs">{txSettings.external_url}</span>
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Configure via VERBATIM_WHISPERX_EXTERNAL_URL env var</p>
              </div>
            )}

            {/* Footer note */}
            <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
              Changes take effect on the next transcription job. No restart required.
            </p>
          </div>
        </div>
      )}

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

      {/* Backup & Restore Section */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Backup & Restore</h2>
        </div>
        <div className="px-5 py-4">
          {/* Archive Info */}
          {archiveInfo && (
            <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
              <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-gray-400">
                <div>Recordings: <span className="font-medium text-gray-900 dark:text-gray-100">{archiveInfo.recordings_count}</span></div>
                <div>Transcripts: <span className="font-medium text-gray-900 dark:text-gray-100">{archiveInfo.transcripts_count}</span></div>
                <div>Projects: <span className="font-medium text-gray-900 dark:text-gray-100">{archiveInfo.projects_count}</span></div>
                <div>Media Size: <span className="font-medium text-gray-900 dark:text-gray-100">{(archiveInfo.media_size_bytes / 1024 / 1024).toFixed(1)} MB</span></div>
              </div>
            </div>
          )}

          {/* Import Result */}
          {importResult && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              importResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {importResult.message}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Export Backup
                </>
              )}
            </button>

            <button
              onClick={handleImportClick}
              disabled={isImporting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {isImporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Importing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Restore Backup
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".vbz,.zip"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Export creates a .vbz archive with all your recordings, transcripts, and projects.
          </p>
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
