import { useState, useEffect, useCallback } from 'react';
import { api, type OAuthCredentialsResponse } from '@/lib/api';
import { MarkdownModal } from '@/components/ui/MarkdownModal';

const SETUP_GUIDE = `## Redirect URIs (Required for All Providers)

Add **all 4** of these URIs to your OAuth app configuration:

\`\`\`
http://localhost:9876/callback
http://localhost:9877/callback
http://localhost:9878/callback
http://localhost:9879/callback
\`\`\`

The app tries different ports if one is busy.

---

## Google Drive

1. [Create a Google Cloud Project](https://console.cloud.google.com/projectcreate)
2. [Enable the Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) ← **Required**
3. [Configure OAuth Branding](https://console.cloud.google.com/auth/branding) → Add app name & info
4. [Add Scopes](https://console.cloud.google.com/auth/scopes) → Add \`drive.file\`
5. [Add Test User](https://console.cloud.google.com/auth/audience) → Add your email
6. [Create OAuth Credentials](https://console.cloud.google.com/apis/credentials) → OAuth client ID → Web application
7. Add all 4 redirect URIs, copy Client ID & Secret

**Troubleshooting**

- \`access_denied\` → [Verify test user](https://console.cloud.google.com/auth/audience) is added
- \`API not enabled\` → [Enable Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- \`Invalid redirect URI\` → Add all 4 URIs exactly as shown above

---

## Microsoft OneDrive

[Open Azure App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)

1. **New registration** → Name it → Select **"Accounts in any organizational directory and personal Microsoft accounts"**
2. **Owners** → Add yourself as owner
3. **Authentication** → Add platform → Web → Add all 4 redirect URIs → Enable **ID tokens** under "Implicit grant"
4. **Certificates & secrets** → New client secret → Copy **Value** immediately (not the Secret ID)
5. **API permissions** → Add permission → Microsoft Graph → Delegated → \`Files.ReadWrite\` and \`User.Read\`
6. **Overview** → Copy **Application (client) ID** ← This is the Client ID for Verbatim Studio

**Troubleshooting**

- \`unauthorized_client\` / \`not enabled for consumers\` → App must support personal accounts. Recreate and select "personal Microsoft accounts"
- \`AADSTS50011\` → Redirect URI mismatch, add all 4 URIs exactly as shown above
- \`AADSTS7000215\` → Invalid client secret, create a new one and copy the **Value** (not ID)
- \`AADSTS65001\` → Missing permissions, add \`Files.ReadWrite\` scope

---

## Dropbox

1. [Create App](https://www.dropbox.com/developers/apps/create) → Scoped access → Full Dropbox
2. **Permissions** → Enable \`files.metadata.read\`, \`files.metadata.write\`, \`files.content.read\`, \`files.content.write\`
3. **Settings** → Add all 4 redirect URIs
4. Copy **App key** (Client ID) and **App secret** (Client Secret)

**Troubleshooting**

- \`invalid_scope\` → Go to Permissions tab and enable all Files and folders permissions
- \`invalid_redirect_uri\` → Add all 4 URIs exactly as shown above
`;

interface OAuthCredentialsConfigProps {
  onUpdate?: () => void;
}

const PROVIDERS = [
  {
    id: 'gdrive',
    name: 'Google Drive',
    icon: 'G',
    manageUrl: 'https://myaccount.google.com/connections',
    manageLabel: 'Manage Google access',
  },
  {
    id: 'onedrive',
    name: 'Microsoft OneDrive',
    icon: 'M',
    manageUrl: 'https://account.live.com/consent/Manage',
    manageLabel: 'Manage Microsoft access',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    icon: 'D',
    manageUrl: 'https://www.dropbox.com/account/connected_apps',
    manageLabel: 'Manage Dropbox access',
  },
] as const;

export function OAuthCredentialsConfig({ onUpdate }: OAuthCredentialsConfigProps) {
  const [credentials, setCredentials] = useState<OAuthCredentialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState({ client_id: '', client_secret: '' });
  const [saving, setSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

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

      <button
        onClick={() => setShowGuide(true)}
        className="w-full p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-left hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
      >
        <p className="text-blue-800 dark:text-blue-200 font-medium mb-1 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Setup Guide
          <span className="text-xs font-normal text-blue-600 dark:text-blue-400 group-hover:underline">(click to view)</span>
        </p>
        <p className="text-blue-700 dark:text-blue-300">
          Step-by-step instructions for Google Drive, OneDrive, and Dropbox.
        </p>
      </button>

      <MarkdownModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        title="Cloud Storage Setup Guide"
        content={SETUP_GUIDE}
      />

      <div className="space-y-3">
        {PROVIDERS.map(({ id, name, icon, manageUrl, manageLabel }) => {
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
                  <a
                    href={manageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {manageLabel}
                  </a>
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
