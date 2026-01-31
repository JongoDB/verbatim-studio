import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type ArchiveInfo, type TranscriptionSettings, type AIModel, type AIModelDownloadEvent, type SystemInfo, type StorageLocation, type MigrationStatus, type StorageType, type StorageSubtype, type StorageLocationConfig } from '@/lib/api';
import { StorageTypeSelector } from '@/components/storage/StorageTypeSelector';
import { StorageSubtypeSelector } from '@/components/storage/StorageSubtypeSelector';
import { StorageConfigForm } from '@/components/storage/StorageConfigForm';
import { TIMEZONE_OPTIONS, getStoredTimezone, setStoredTimezone, type TimezoneValue } from '@/lib/utils';

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

  // AI / LLM model state
  const [aiModels, setAiModels] = useState<AIModel[]>([]);
  const [aiDownloading, setAiDownloading] = useState<string | null>(null);
  const [aiDownloadedBytes, setAiDownloadedBytes] = useState(0);
  const [aiTotalBytes, setAiTotalBytes] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const downloadAbortRef = useRef<{ abort: () => void } | null>(null);

  // System info state
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  // Storage locations state
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationType, setNewLocationType] = useState<StorageType>('local');
  const [newLocationSubtype, setNewLocationSubtype] = useState<StorageSubtype>(null);
  const [newLocationConfig, setNewLocationConfig] = useState<StorageLocationConfig>({});
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<StorageLocation | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Migration state
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [migrationSource, setMigrationSource] = useState('');
  const [migrationDest, setMigrationDest] = useState('');
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [pendingLocationUpdate, setPendingLocationUpdate] = useState<StorageLocation | null>(null);

  const defaultLanguage = settings.defaultLanguage || '';
  const defaultPlaybackSpeed = settings.defaultPlaybackSpeed || 1;
  const autoTranscribe = settings.autoTranscribe ?? false;

  const loadStorageLocations = useCallback(() => {
    api.storageLocations.list()
      .then((r) => setStorageLocations(r.items))
      .catch(console.error);
  }, []);

  // Load archive info, config status, transcription settings, AI models, system info, and storage locations
  useEffect(() => {
    api.archive.info().then(setArchiveInfo).catch(console.error);
    api.config.getTranscription().then(setTxSettings).catch(console.error);
    api.ai.listModels().then((r) => setAiModels(r.models)).catch(console.error);
    api.system.info().then(setSystemInfo).catch(console.error);
    loadStorageLocations();
  }, [loadStorageLocations]);

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

  const refreshAiModels = useCallback(() => {
    api.ai.listModels().then((r) => setAiModels(r.models)).catch(console.error);
  }, []);

  const handleDownloadModel = useCallback((modelId: string) => {
    setAiDownloading(modelId);
    setAiDownloadedBytes(0);
    setAiTotalBytes(0);
    setAiError(null);

    const handle = api.ai.downloadModel(modelId, (event: AIModelDownloadEvent) => {
      if (event.status === 'progress') {
        setAiDownloadedBytes(event.downloaded_bytes || 0);
        setAiTotalBytes(event.total_bytes || 0);
      } else if (event.status === 'complete' || event.status === 'activated') {
        setAiDownloading(null);
        setAiDownloadedBytes(0);
        setAiTotalBytes(0);
        refreshAiModels();
      } else if (event.status === 'error') {
        setAiError(event.error || 'Download failed');
        setAiDownloading(null);
      }
    });

    downloadAbortRef.current = handle;
  }, [refreshAiModels]);

  const handleActivateModel = useCallback(async (modelId: string) => {
    try {
      await api.ai.activateModel(modelId);
      refreshAiModels();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Activation failed');
    }
  }, [refreshAiModels]);

  const handleDeleteModel = useCallback(async (modelId: string) => {
    try {
      await api.ai.deleteModel(modelId);
      refreshAiModels();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [refreshAiModels]);

  // Storage location handlers
  const resetAddLocationForm = useCallback(() => {
    setNewLocationName('');
    setNewLocationType('local');
    setNewLocationSubtype(null);
    setNewLocationConfig({});
    setConnectionTestResult(null);
    setStorageError(null);
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const result = await api.storageLocations.test({
        type: newLocationType,
        subtype: newLocationSubtype,
        config: newLocationConfig,
      });
      setConnectionTestResult({ success: result.success, message: result.error || (result.success ? 'Connection successful' : 'Connection failed') });
    } catch (err) {
      setConnectionTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTestingConnection(false);
    }
  }, [newLocationType, newLocationSubtype, newLocationConfig]);

  const handleAddStorageLocation = useCallback(async () => {
    if (!newLocationName.trim()) return;
    // Validate config based on type
    if (newLocationType === 'local' && !newLocationConfig.path?.trim()) return;
    if (newLocationType === 'network' && !newLocationSubtype) return;
    if (newLocationType === 'cloud' && !newLocationSubtype) return;

    setStorageSaving(true);
    setStorageError(null);
    try {
      await api.storageLocations.create({
        name: newLocationName.trim(),
        type: newLocationType,
        subtype: newLocationSubtype,
        config: newLocationConfig,
        is_default: storageLocations.length === 0,
      });
      resetAddLocationForm();
      setShowAddLocation(false);
      loadStorageLocations();
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Failed to add storage location');
    } finally {
      setStorageSaving(false);
    }
  }, [newLocationName, newLocationType, newLocationSubtype, newLocationConfig, storageLocations.length, loadStorageLocations, resetAddLocationForm]);

  const handleUpdateStorageLocation = useCallback(async () => {
    if (!editingLocation) return;

    // Check if path is changing
    const originalLocation = storageLocations.find(l => l.id === editingLocation.id);
    const oldPath = originalLocation?.config?.path;
    const newPath = editingLocation.config?.path;

    if (oldPath && newPath && oldPath !== newPath) {
      // Path is changing - ask about migration
      setMigrationSource(oldPath);
      setMigrationDest(newPath);
      setPendingLocationUpdate(editingLocation);
      setShowMigrationDialog(true);
      return;
    }

    // Path not changing, proceed with update
    await performLocationUpdate(editingLocation);
  }, [editingLocation, storageLocations]);

  const performLocationUpdate = useCallback(async (location: StorageLocation) => {
    setStorageSaving(true);
    setStorageError(null);
    try {
      await api.storageLocations.update(location.id, {
        name: location.name,
        config: location.config,
      });
      setEditingLocation(null);
      loadStorageLocations();
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Failed to update storage location');
    } finally {
      setStorageSaving(false);
    }
  }, [loadStorageLocations]);

  const handleStartMigration = useCallback(async () => {
    if (!pendingLocationUpdate) return;

    setMigrationStatus({
      status: 'running',
      total_files: 0,
      migrated_files: 0,
      total_bytes: 0,
      migrated_bytes: 0,
      current_file: null,
      error: null,
    });

    try {
      // Start the migration
      const status = await api.storageLocations.migrate({
        source_path: migrationSource,
        destination_path: migrationDest,
      });
      setMigrationStatus(status);

      // Poll for status updates
      const pollInterval = setInterval(async () => {
        try {
          const currentStatus = await api.storageLocations.getMigrationStatus();
          setMigrationStatus(currentStatus);

          if (currentStatus.status === 'completed' || currentStatus.status === 'failed') {
            clearInterval(pollInterval);

            if (currentStatus.status === 'completed') {
              // Migration complete, update the storage location
              await performLocationUpdate(pendingLocationUpdate);
              setShowMigrationDialog(false);
              setPendingLocationUpdate(null);
              setMigrationStatus(null);
            }
          }
        } catch (err) {
          console.error('Failed to get migration status:', err);
        }
      }, 500);
    } catch (err) {
      setMigrationStatus({
        status: 'failed',
        total_files: 0,
        migrated_files: 0,
        total_bytes: 0,
        migrated_bytes: 0,
        current_file: null,
        error: err instanceof Error ? err.message : 'Failed to start migration',
      });
    }
  }, [migrationSource, migrationDest, pendingLocationUpdate, performLocationUpdate]);

  const handleSkipMigration = useCallback(async () => {
    if (!pendingLocationUpdate) return;
    // User chose not to migrate - just update the location
    await performLocationUpdate(pendingLocationUpdate);
    setShowMigrationDialog(false);
    setPendingLocationUpdate(null);
  }, [pendingLocationUpdate, performLocationUpdate]);

  const handleCancelMigration = useCallback(() => {
    setShowMigrationDialog(false);
    setPendingLocationUpdate(null);
    setMigrationStatus(null);
  }, []);

  const handleSetDefaultLocation = useCallback(async (id: string) => {
    setStorageError(null);
    try {
      await api.storageLocations.update(id, { is_default: true });
      loadStorageLocations();
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Failed to set default');
    }
  }, [loadStorageLocations]);

  const handleDeleteStorageLocation = useCallback(async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this storage location?')) return;
    setStorageError(null);
    try {
      await api.storageLocations.delete(id);
      loadStorageLocations();
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Failed to delete storage location');
    }
  }, [loadStorageLocations]);

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const updateSetting = (key: string, value: unknown) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings(newSettings);
    setSaved(true);
  };

  // Tab state - check URL hash for direct linking
  const [activeTab, setActiveTab] = useState<'general' | 'transcription' | 'ai' | 'system'>(() => {
    const hash = window.location.hash.slice(1);
    if (['general', 'transcription', 'ai', 'system'].includes(hash)) {
      return hash as 'general' | 'transcription' | 'ai' | 'system';
    }
    return 'general';
  });

  // Update URL hash when tab changes
  const handleTabChange = (tab: 'general' | 'transcription' | 'ai' | 'system') => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  };

  const TABS = [
    { id: 'general' as const, label: 'General', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: 'transcription' as const, label: 'Transcription', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    )},
    { id: 'ai' as const, label: 'AI', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    )},
    { id: 'system' as const, label: 'System', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    )},
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure your Verbatim Studio preferences
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Settings tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
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

      {/* ===== GENERAL TAB ===== */}
      {activeTab === 'general' && (
        <>
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

          <SettingSection
            title="Timezone"
            description="Display dates and times in your preferred timezone"
          >
            <select
              value={getStoredTimezone()}
              onChange={(e) => {
                setStoredTimezone(e.target.value as TimezoneValue);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}{tz.offset ? ` (${tz.offset})` : ''}
                </option>
              ))}
            </select>
          </SettingSection>
        </div>
      </div>
        </>
      )}

      {/* ===== TRANSCRIPTION TAB ===== */}
      {activeTab === 'transcription' && (
        <>
      {/* Transcription Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
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

      {/* Transcription Engine Configuration */}
      {txSettings && (
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Transcription Engine</h2>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                txSettings.effective_engine === 'mlx-whisper'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  : txSettings.mode === 'external'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              }`}>
                {txSettings.mode === 'external' ? 'External Service' : txSettings.effective_engine === 'mlx-whisper' ? 'MLX Whisper (Apple Silicon)' : 'WhisperX'}
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
            {/* Engine Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Engine</label>
              <select
                value={txSettings.engine}
                onChange={(e) => updateTxSetting('engine', e.target.value)}
                disabled={txSaving}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="auto">Auto (Recommended)</option>
                {txSettings.available_engines.includes('whisperx') && (
                  <option value="whisperx">WhisperX (CPU/CUDA)</option>
                )}
                {txSettings.available_engines.includes('mlx-whisper') && (
                  <option value="mlx-whisper">MLX Whisper (Apple Silicon GPU)</option>
                )}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {txSettings.engine === 'auto'
                  ? `Auto-detected: ${txSettings.effective_engine === 'mlx-whisper' ? 'MLX Whisper' : 'WhisperX'}`
                  : txSettings.effective_engine === 'mlx-whisper'
                    ? 'MLX Whisper uses Apple Silicon GPU for fast transcription'
                    : 'WhisperX uses CPU or NVIDIA GPU'}
              </p>
            </div>

            {/* Engine Caveats */}
            {txSettings.engine_caveats.length > 0 && (
              <div className="space-y-2">
                {txSettings.engine_caveats.map((caveat, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg text-sm ${
                      caveat.includes('not supported') || caveat.includes('requires')
                        ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                        : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                    }`}
                  >
                    {caveat}
                  </div>
                ))}
              </div>
            )}

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
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        </>
      )}

      {/* ===== AI TAB ===== */}
      {activeTab === 'ai' && (
        <>
      {/* Large Language Model Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Large Language Model</h2>
            {aiModels.some((m) => m.active) ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Ready ({aiModels.find((m) => m.active)?.label})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                No model downloaded
              </span>
            )}
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {aiError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {aiError}
              <button onClick={() => setAiError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Available Models</label>
            <div className="space-y-3">
              {aiModels.map((model) => (
                <div
                  key={model.id}
                  className={`p-4 rounded-lg border transition-all ${
                    model.active
                      ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
                      : 'border-gray-200 dark:border-gray-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{model.label}</span>
                        {model.is_default && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                            Recommended
                          </span>
                        )}
                        {model.active && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Active
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{model.description}</p>
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{formatBytes(model.size_bytes)}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!model.downloaded && aiDownloading !== model.id && (
                        <button
                          onClick={() => handleDownloadModel(model.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Download
                        </button>
                      )}

                      {model.downloaded && !model.active && aiDownloading !== model.id && (
                        <button
                          onClick={() => handleActivateModel(model.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-success text-success-foreground hover:bg-success/90 transition-colors"
                        >
                          Activate
                        </button>
                      )}

                      {model.downloaded && aiDownloading !== model.id && (
                        <button
                          onClick={() => handleDeleteModel(model.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Download progress bar */}
                    {aiDownloading === model.id && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <span>Downloading...</span>
                          <span>
                            {aiTotalBytes > 0
                              ? `${formatBytes(aiDownloadedBytes)} / ${formatBytes(aiTotalBytes)}`
                              : 'Starting...'}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full transition-all duration-300"
                            style={{ width: aiTotalBytes > 0 ? `${Math.min(100, (aiDownloadedBytes / aiTotalBytes) * 100)}%` : '0%' }}
                          />
                        </div>
                        {aiTotalBytes > 0 && (
                          <div className="text-right text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {Math.round((aiDownloadedBytes / aiTotalBytes) * 100)}%
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {aiModels.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                  Loading model catalog...
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
            Models are downloaded from HuggingFace and stored locally. All AI processing happens on your machine.
          </p>
        </div>
      </div>
        </>
      )}

      {/* ===== GENERAL TAB (continued) - Playback & Shortcuts ===== */}
      {activeTab === 'general' && (
        <>
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
        </>
      )}

      {/* ===== SYSTEM TAB ===== */}
      {activeTab === 'system' && (
        <>
      {/* Storage Locations Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Storage Locations</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Configure where your files and media are stored on disk</p>
          </div>
          {!showAddLocation && (
            <button
              onClick={() => setShowAddLocation(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Location
            </button>
          )}
        </div>
        <div className="px-5 py-4 space-y-4">
          {storageError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {storageError}
              <button onClick={() => setStorageError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          {/* Add new location form */}
          {showAddLocation && (
            <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Add New Storage Location</h3>

              {/* Name input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
                <input
                  type="text"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                  placeholder="e.g., My Cloud Storage"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Storage type selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Storage Type</label>
                <StorageTypeSelector
                  value={newLocationType}
                  onChange={(type) => {
                    setNewLocationType(type);
                    setNewLocationSubtype(null);
                    setNewLocationConfig({});
                    setConnectionTestResult(null);
                  }}
                />
              </div>

              {/* Subtype selector (for network/cloud) */}
              {newLocationType !== 'local' && (
                <StorageSubtypeSelector
                  storageType={newLocationType}
                  value={newLocationSubtype}
                  onChange={(subtype) => {
                    setNewLocationSubtype(subtype);
                    setNewLocationConfig({});
                    setConnectionTestResult(null);
                  }}
                />
              )}

              {/* Configuration form */}
              {(newLocationType === 'local' || newLocationSubtype) && (
                <StorageConfigForm
                  storageType={newLocationType}
                  subtype={newLocationSubtype}
                  config={newLocationConfig}
                  onChange={setNewLocationConfig}
                />
              )}

              {/* Connection test result */}
              {connectionTestResult && (
                <div className={`p-3 rounded-lg text-sm ${
                  connectionTestResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
                }`}>
                  {connectionTestResult.success ? '✓ ' : '✗ '}{connectionTestResult.message}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => { setShowAddLocation(false); resetAddLocationForm(); }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                {(newLocationType !== 'local' && newLocationSubtype) && (
                  <button
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                  >
                    {testingConnection ? 'Testing...' : 'Test Connection'}
                  </button>
                )}
                <button
                  onClick={handleAddStorageLocation}
                  disabled={storageSaving || !newLocationName.trim() || (newLocationType === 'local' && !newLocationConfig.path?.trim()) || (newLocationType !== 'local' && !newLocationSubtype)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {storageSaving ? 'Adding...' : 'Add Location'}
                </button>
              </div>
            </div>
          )}

          {/* Location list */}
          <div className="space-y-3">
            {storageLocations.map((location) => (
              <div
                key={location.id}
                className={`p-4 rounded-lg border transition-all ${
                  location.is_default
                    ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
                    : 'border-gray-200 dark:border-gray-600'
                }`}
              >
                {editingLocation?.id === location.id ? (
                  // Edit mode
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                      <input
                        type="text"
                        value={editingLocation.name}
                        onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Path</label>
                      <input
                        type="text"
                        value={editingLocation.config.path || ''}
                        onChange={(e) => setEditingLocation({ ...editingLocation, config: { ...editingLocation.config, path: e.target.value } })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingLocation(null)}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleUpdateStorageLocation}
                        disabled={storageSaving}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {storageSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{location.name}</span>
                        {location.is_default && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Default
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                          {location.type}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 truncate" title={location.config.path}>
                        {location.config.path}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!location.is_default && (
                        <button
                          onClick={() => handleSetDefaultLocation(location.id)}
                          className="p-1.5 text-gray-400 hover:text-green-600 dark:hover:text-green-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Set as default"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setEditingLocation(location)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {storageLocations.length > 1 && (
                        <button
                          onClick={() => handleDeleteStorageLocation(location.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {storageLocations.length === 0 && !showAddLocation && (
              <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-sm">No storage locations configured</p>
                <p className="text-xs mt-1">Add a location to specify where files are stored</p>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
            Storage locations determine where recordings, documents, and other media files are saved. The default location is used for new uploads.
          </p>
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
        </>
      )}

      {/* ===== GENERAL TAB (continued) - About ===== */}
      {activeTab === 'general' && (
        <>
      {/* About Section */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">About Verbatim Studio</h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="text-gray-900 dark:text-gray-100">Transcription you can trust.</strong> Verbatim Studio is a privacy-first transcription platform designed for researchers, journalists, legal professionals, and anyone who needs accurate, secure transcription.
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              All processing happens locally on your machine. Your recordings and transcripts never leave your computer.
            </p>
          </div>

          {/* Current Features */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Current Features</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>Local AI Transcription</strong> — WhisperX and MLX Whisper engines with speaker diarization</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>Live Transcription</strong> — Real-time transcription from microphone input</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>AI Assistant (Max)</strong> — Chat with your transcripts, ask questions, get summaries</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>Semantic Search</strong> — Find content by meaning, not just keywords</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>Project Organization</strong> — Group recordings into projects with types and tags</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span><strong>Export Options</strong> — TXT, SRT, VTT, JSON, and full backup archives</span>
              </li>
            </ul>
          </div>

          {/* Coming Soon */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Coming Soon</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong>Document Management</strong> — Upload PDFs, images, and notes with OCR</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong>Desktop App</strong> — Native Electron application for macOS, Windows, and Linux</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong>Video Support</strong> — Transcribe video files with visual timeline sync</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong>Team Collaboration</strong> — Share projects securely with end-to-end encryption</span>
              </li>
            </ul>
          </div>

          {/* Links */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-4 text-sm">
            <a
              href="https://github.com/JongoDB/verbatim-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub
            </a>
            <a
              href="https://github.com/JongoDB/verbatim-studio/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Report an Issue
            </a>
          </div>
        </div>
      </div>
        </>
      )}

      {/* ===== SYSTEM TAB (continued) - System Information ===== */}
      {activeTab === 'system' && systemInfo && (
        <>
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">System Information</h2>
          </div>
          <div className="px-5 py-4 space-y-6">
            {/* App Info */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Application</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Version</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{systemInfo.app_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Python</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{systemInfo.python_version}</span>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-gray-500 dark:text-gray-400">Platform</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100 text-right truncate ml-4" title={systemInfo.platform_version}>
                    {systemInfo.platform}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Max Upload</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{formatBytes(systemInfo.max_upload_bytes)}</span>
                </div>
              </div>
            </div>

            {/* Storage Paths */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Storage Paths</h3>
              <div className="space-y-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">Data Directory</span>
                  <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate" title={systemInfo.paths.data_dir}>
                    {systemInfo.paths.data_dir}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">Media Directory</span>
                  <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate" title={systemInfo.paths.media_dir}>
                    {systemInfo.paths.media_dir}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">Models Directory</span>
                  <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate" title={systemInfo.paths.models_dir}>
                    {systemInfo.paths.models_dir}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">Database</span>
                  <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate" title={systemInfo.paths.database_path}>
                    {systemInfo.paths.database_path}
                  </span>
                </div>
              </div>
            </div>

            {/* Disk Usage */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Disk Usage</h3>
              <div className="space-y-2">
                <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      systemInfo.disk_usage.percent_used > 90
                        ? 'bg-red-500'
                        : systemInfo.disk_usage.percent_used > 75
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${systemInfo.disk_usage.percent_used}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatBytes(systemInfo.disk_usage.free_bytes)} free of {formatBytes(systemInfo.disk_usage.total_bytes)} ({systemInfo.disk_usage.percent_used}% used)
                </p>
              </div>
            </div>

            {/* Storage Breakdown */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Verbatim Storage</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Media Files</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {systemInfo.storage_breakdown.media_count} files ({formatBytes(systemInfo.storage_breakdown.media_bytes)})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Database</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {formatBytes(systemInfo.storage_breakdown.database_bytes)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">AI Models</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {systemInfo.storage_breakdown.models_count} models ({formatBytes(systemInfo.storage_breakdown.models_bytes)})
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-gray-700 font-medium">
                  <span className="text-gray-700 dark:text-gray-300">Total</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {formatBytes(systemInfo.storage_breakdown.total_bytes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Content Counts */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Content</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {systemInfo.content_counts.recordings}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Recordings</div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {systemInfo.content_counts.transcripts}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Transcripts</div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {systemInfo.content_counts.segments.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Segments</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </>
      )}

      {/* Migration Dialog */}
      {showMigrationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Migrate Files to New Location?
            </h3>

            {!migrationStatus && (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  You're changing the storage location. Would you like to move existing files to the new location?
                </p>

                <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 space-y-1">
                  <div><span className="font-medium">From:</span> {migrationSource}</div>
                  <div><span className="font-medium">To:</span> {migrationDest}</div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleStartMigration}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium"
                  >
                    Move Files
                  </button>
                  <button
                    onClick={handleSkipMigration}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
                  >
                    Don't Move
                  </button>
                  <button
                    onClick={handleCancelMigration}
                    className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {migrationStatus?.status === 'running' && (
              <>
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>Migrating files...</span>
                    <span>{migrationStatus.migrated_files} / {migrationStatus.total_files}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{
                        width: migrationStatus.total_files > 0
                          ? `${(migrationStatus.migrated_files / migrationStatus.total_files) * 100}%`
                          : '0%'
                      }}
                    />
                  </div>
                  {migrationStatus.current_file && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
                      {migrationStatus.current_file}
                    </p>
                  )}
                </div>
              </>
            )}

            {migrationStatus?.status === 'completed' && (
              <div className="text-center py-4">
                <svg className="w-12 h-12 text-green-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-gray-600 dark:text-gray-400">
                  Migration complete! {migrationStatus.migrated_files} files moved.
                </p>
              </div>
            )}

            {migrationStatus?.status === 'failed' && (
              <div className="text-center py-4">
                <svg className="w-12 h-12 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <p className="text-red-600 dark:text-red-400 mb-2">
                  Migration failed
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {migrationStatus.error}
                </p>
                <button
                  onClick={handleCancelMigration}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
