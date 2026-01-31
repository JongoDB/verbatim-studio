import type { StorageType, StorageSubtype, StorageLocationConfig } from '@/lib/api';

interface StorageConfigFormProps {
  storageType: StorageType;
  subtype: StorageSubtype;
  config: StorageLocationConfig;
  onChange: (config: StorageLocationConfig) => void;
}

const inputClasses = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const labelClasses = "block text-sm font-medium text-foreground mb-1.5";
const hintClasses = "text-xs text-muted-foreground mt-1";

export function StorageConfigForm({ storageType, subtype, config, onChange }: StorageConfigFormProps) {
  const updateField = (field: string, value: string) => {
    onChange({ ...config, [field]: value || undefined });
  };

  // Local storage
  if (storageType === 'local') {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="path" className={labelClasses}>Path</label>
          <input
            id="path"
            type="text"
            value={config.path || ''}
            onChange={(e) => updateField('path', e.target.value)}
            placeholder="/path/to/storage"
            className={`${inputClasses} font-mono`}
          />
          <p className={hintClasses}>
            Full path to a folder. It will be created if it doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  // SMB
  if (storageType === 'network' && subtype === 'smb') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="server" className={labelClasses}>Server</label>
            <input
              id="server"
              type="text"
              value={config.server || ''}
              onChange={(e) => updateField('server', e.target.value)}
              placeholder="192.168.1.100 or nas.local"
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="share" className={labelClasses}>Share Name</label>
            <input
              id="share"
              type="text"
              value={config.share || ''}
              onChange={(e) => updateField('share', e.target.value)}
              placeholder="media"
              className={inputClasses}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="username" className={labelClasses}>Username</label>
            <input
              id="username"
              type="text"
              value={config.username || ''}
              onChange={(e) => updateField('username', e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="password" className={labelClasses}>Password</label>
            <input
              id="password"
              type="password"
              value={config.password || ''}
              onChange={(e) => updateField('password', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
        <div>
          <label htmlFor="domain" className={labelClasses}>Domain (optional)</label>
          <input
            id="domain"
            type="text"
            value={config.domain || ''}
            onChange={(e) => updateField('domain', e.target.value)}
            placeholder="WORKGROUP"
            className={inputClasses}
          />
        </div>
      </div>
    );
  }

  // NFS
  if (storageType === 'network' && subtype === 'nfs') {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="server" className={labelClasses}>Server</label>
          <input
            id="server"
            type="text"
            value={config.server || ''}
            onChange={(e) => updateField('server', e.target.value)}
            placeholder="192.168.1.100"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="export_path" className={labelClasses}>Export Path</label>
          <input
            id="export_path"
            type="text"
            value={config.export_path || ''}
            onChange={(e) => updateField('export_path', e.target.value)}
            placeholder="/exports/media"
            className={`${inputClasses} font-mono`}
          />
        </div>
      </div>
    );
  }

  // S3
  if (storageType === 'cloud' && subtype === 's3') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="bucket" className={labelClasses}>Bucket</label>
            <input
              id="bucket"
              type="text"
              value={config.bucket || ''}
              onChange={(e) => updateField('bucket', e.target.value)}
              placeholder="my-bucket"
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="region" className={labelClasses}>Region</label>
            <input
              id="region"
              type="text"
              value={config.region || ''}
              onChange={(e) => updateField('region', e.target.value)}
              placeholder="us-east-1"
              className={inputClasses}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="access_key" className={labelClasses}>Access Key</label>
            <input
              id="access_key"
              type="text"
              value={config.access_key || ''}
              onChange={(e) => updateField('access_key', e.target.value)}
              className={`${inputClasses} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="secret_key" className={labelClasses}>Secret Key</label>
            <input
              id="secret_key"
              type="password"
              value={config.secret_key || ''}
              onChange={(e) => updateField('secret_key', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
        <div>
          <label htmlFor="endpoint" className={labelClasses}>Custom Endpoint (optional)</label>
          <input
            id="endpoint"
            type="text"
            value={config.endpoint || ''}
            onChange={(e) => updateField('endpoint', e.target.value)}
            placeholder="https://s3.us-west-001.backblazeb2.com"
            className={inputClasses}
          />
          <p className={hintClasses}>
            For Backblaze B2, Wasabi, MinIO, etc. Leave empty for AWS S3.
          </p>
        </div>
      </div>
    );
  }

  // Azure
  if (storageType === 'cloud' && subtype === 'azure') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="account_name" className={labelClasses}>Account Name</label>
            <input
              id="account_name"
              type="text"
              value={config.account_name || ''}
              onChange={(e) => updateField('account_name', e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="container" className={labelClasses}>Container</label>
            <input
              id="container"
              type="text"
              value={config.container || ''}
              onChange={(e) => updateField('container', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
        <div>
          <label htmlFor="account_key" className={labelClasses}>Account Key</label>
          <input
            id="account_key"
            type="password"
            value={config.account_key || ''}
            onChange={(e) => updateField('account_key', e.target.value)}
            className={inputClasses}
          />
        </div>
      </div>
    );
  }

  // GCS
  if (storageType === 'cloud' && subtype === 'gcs') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="bucket" className={labelClasses}>Bucket</label>
            <input
              id="bucket"
              type="text"
              value={config.bucket || ''}
              onChange={(e) => updateField('bucket', e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="project_id" className={labelClasses}>Project ID</label>
            <input
              id="project_id"
              type="text"
              value={config.project_id || ''}
              onChange={(e) => updateField('project_id', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
        <div>
          <label htmlFor="credentials_json" className={labelClasses}>Service Account JSON</label>
          <textarea
            id="credentials_json"
            value={config.credentials_json || ''}
            onChange={(e) => updateField('credentials_json', e.target.value)}
            placeholder='{"type": "service_account", ...}'
            className="w-full h-32 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
      </div>
    );
  }

  // OAuth providers placeholder
  if (storageType === 'cloud' && ['gdrive', 'onedrive', 'dropbox'].includes(subtype || '')) {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="folder_path" className={labelClasses}>Folder Path (optional)</label>
          <input
            id="folder_path"
            type="text"
            value={config.folder_path || ''}
            onChange={(e) => updateField('folder_path', e.target.value)}
            placeholder="Verbatim Studio"
            className={inputClasses}
          />
          <p className={hintClasses}>
            Leave empty to use root folder.
          </p>
        </div>
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Click "Connect" below to authenticate with {
            subtype === 'gdrive' ? 'Google' :
            subtype === 'onedrive' ? 'Microsoft' :
            'Dropbox'
          }.
        </p>
      </div>
    );
  }

  return (
    <div className="text-muted-foreground text-sm">
      Select a storage type and provider to configure.
    </div>
  );
}
