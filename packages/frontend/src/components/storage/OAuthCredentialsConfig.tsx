import { useState, useEffect, useCallback } from 'react';
import { api, type OAuthCredentialsResponse } from '@/lib/api';

interface OAuthCredentialsConfigProps {
  onUpdate?: () => void;
}

const PROVIDERS = [
  { id: 'gdrive', name: 'Google Drive', icon: 'G' },
  { id: 'onedrive', name: 'Microsoft OneDrive', icon: 'M' },
  { id: 'dropbox', name: 'Dropbox', icon: 'D' },
] as const;

// OAuth callback URIs - the backend tries these ports in order if one is busy
const OAUTH_REDIRECT_URIS = [
  'http://localhost:9876/callback',
  'http://localhost:9877/callback',
  'http://localhost:9878/callback',
  'http://localhost:9879/callback',
];

export function OAuthCredentialsConfig({ onUpdate }: OAuthCredentialsConfigProps) {
  const [credentials, setCredentials] = useState<OAuthCredentialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState({ client_id: '', client_secret: '' });
  const [saving, setSaving] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  const copyRedirectUris = useCallback(async () => {
    const urisText = OAUTH_REDIRECT_URIS.join('\n');
    try {
      await navigator.clipboard.writeText(urisText);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('textarea');
      input.value = urisText;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    }
  }, []);

  const loadCredentials = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.config.getOAuthCredentials();
      setCredentials(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  const handleEdit = (provider: string) => {
    const creds = credentials?.[provider as keyof OAuthCredentialsResponse];
    setFormData({
      client_id: creds?.client_id || '',
      client_secret: '', // Never pre-fill secret
    });
    setEditingProvider(provider);
  };

  const handleSave = async () => {
    if (!editingProvider) return;

    setSaving(true);
    try {
      await api.config.setOAuthCredentials(editingProvider, formData);
      setEditingProvider(null);
      await loadCredentials();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (provider: string) => {
    if (!confirm(`Remove ${provider} credentials? Users will need to reconfigure this provider.`)) {
      return;
    }

    try {
      await api.config.deleteOAuthCredentials(provider);
      await loadCredentials();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credentials');
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">Loading OAuth credentials...</div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Configure OAuth app credentials to enable cloud storage connections. You'll need to register an app with each provider.
      </p>

      <div className="space-y-3">
        {PROVIDERS.map(({ id, name, icon }) => {
          const creds = credentials?.[id as keyof OAuthCredentialsResponse];
          const isEditing = editingProvider === id;

          return (
            <div
              key={id}
              className={`p-4 rounded-lg border transition-all ${
                creds?.configured
                  ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    id === 'gdrive' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                    id === 'onedrive' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' :
                    'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                    {icon}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{name}</p>
                    {creds?.configured ? (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Configured (Client ID: {creds.client_id.slice(0, 12)}...)
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {creds?.setup_url && (
                    <a
                      href={creds.setup_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      Get credentials
                    </a>
                  )}
                  {creds?.configured && (
                    <button
                      onClick={() => handleDelete(id)}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(id)}
                    className="px-3 py-1 text-sm font-medium rounded-lg border border-border hover:bg-muted"
                  >
                    {creds?.configured ? 'Update' : 'Configure'}
                  </button>
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div className="mt-4 pt-4 border-t border-border space-y-3">
                  {/* Redirect URIs - for copying into provider's OAuth app config */}
                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground">
                          Redirect URIs (add ALL of these to your OAuth app)
                        </label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          The app tries different ports if one is busy
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={copyRedirectUris}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted shrink-0"
                      >
                        {copiedUri ? 'Copied!' : 'Copy All'}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {OAUTH_REDIRECT_URIS.map((uri) => (
                        <code
                          key={uri}
                          className="block text-xs font-mono text-foreground bg-background px-2 py-1 rounded border border-border select-all"
                        >
                          {uri}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Client ID
                    </label>
                    <input
                      type="text"
                      value={formData.client_id}
                      onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                      placeholder="Enter OAuth Client ID"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Client Secret
                    </label>
                    <input
                      type="password"
                      value={formData.client_secret}
                      onChange={(e) => setFormData({ ...formData, client_secret: e.target.value })}
                      placeholder={creds?.has_secret ? '••••••••••••••••' : 'Enter OAuth Client Secret'}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {creds?.has_secret && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave empty to keep existing secret
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setEditingProvider(null)}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !formData.client_id || (!formData.client_secret && !creds?.has_secret)}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
