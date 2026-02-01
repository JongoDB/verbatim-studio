import { cn } from '@/lib/utils';
import type { StorageType, StorageSubtype } from '@/lib/api';

interface StorageSubtypeSelectorProps {
  storageType: StorageType;
  value: StorageSubtype;
  onChange: (subtype: StorageSubtype) => void;
}

const subtypes: Record<StorageType, { subtype: StorageSubtype; label: string; description: string; comingSoon?: boolean }[]> = {
  local: [],
  network: [
    { subtype: 'smb', label: 'SMB / Windows Share', description: 'Samba, Windows file sharing', comingSoon: true },
    { subtype: 'nfs', label: 'NFS', description: 'Network File System (Unix/Linux)', comingSoon: true },
  ],
  cloud: [
    // Interleaved: OAuth providers (left), Object storage (right)
    { subtype: 'gdrive', label: 'Google Drive', description: 'Personal or Workspace account' },
    { subtype: 's3', label: 'S3-Compatible', description: 'AWS S3, Backblaze B2, MinIO, Wasabi', comingSoon: true },
    { subtype: 'onedrive', label: 'OneDrive', description: 'Microsoft OneDrive' },
    { subtype: 'azure', label: 'Azure Blob', description: 'Microsoft Azure Blob Storage', comingSoon: true },
    { subtype: 'dropbox', label: 'Dropbox', description: 'Dropbox cloud storage' },
    { subtype: 'gcs', label: 'Google Cloud Storage', description: 'GCS bucket', comingSoon: true },
  ],
};

export function StorageSubtypeSelector({ storageType, value, onChange }: StorageSubtypeSelectorProps) {
  const options = subtypes[storageType];

  if (options.length === 0) {
    return null;
  }

  // Add column headers for cloud storage
  const showColumnHeaders = storageType === 'cloud';

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Select Provider
      </label>
      {showColumnHeaders && (
        <div className="grid grid-cols-2 gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            OAuth Providers
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Object Storage
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ subtype, label, description, comingSoon }) => (
          <button
            key={subtype}
            type="button"
            onClick={() => !comingSoon && onChange(subtype)}
            disabled={comingSoon}
            className={cn(
              'flex flex-col items-start p-3 rounded-lg border transition-all text-left relative',
              comingSoon
                ? 'opacity-60 cursor-not-allowed border-gray-200 dark:border-gray-700'
                : 'hover:border-primary hover:bg-primary/5',
              value === subtype && !comingSoon
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700'
            )}
          >
            {comingSoon && (
              <span className="absolute top-1 right-1 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                Coming Soon
              </span>
            )}
            <span className="font-medium text-sm">{label}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
