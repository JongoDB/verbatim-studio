import { cn } from '@/lib/utils';
import type { StorageType, StorageSubtype } from '@/lib/api';

interface StorageSubtypeSelectorProps {
  storageType: StorageType;
  value: StorageSubtype;
  onChange: (subtype: StorageSubtype) => void;
}

const subtypes: Record<StorageType, { subtype: StorageSubtype; label: string; description: string }[]> = {
  local: [],
  network: [
    { subtype: 'smb', label: 'SMB / Windows Share', description: 'Samba, Windows file sharing' },
    { subtype: 'nfs', label: 'NFS', description: 'Network File System (Unix/Linux)' },
  ],
  cloud: [], // Handled separately with column layout
};

// Cloud subtypes split into two columns
const oauthProviders: { subtype: StorageSubtype; label: string; description: string }[] = [
  { subtype: 'gdrive', label: 'Google Drive', description: 'Personal or Workspace account' },
  { subtype: 'onedrive', label: 'OneDrive', description: 'Microsoft OneDrive' },
  { subtype: 'dropbox', label: 'Dropbox', description: 'Dropbox cloud storage' },
];

const objectStorage: { subtype: StorageSubtype; label: string; description: string }[] = [
  { subtype: 's3', label: 'S3-Compatible', description: 'AWS S3, Backblaze B2, MinIO, Wasabi' },
  { subtype: 'azure', label: 'Azure Blob', description: 'Microsoft Azure Blob Storage' },
  { subtype: 'gcs', label: 'Google Cloud Storage', description: 'GCS bucket' },
];

function ProviderButton({
  subtype,
  label,
  description,
  selected,
  onClick
}: {
  subtype: StorageSubtype;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start p-3 rounded-lg border transition-all text-left',
        'hover:border-primary hover:bg-primary/5',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700'
      )}
    >
      <span className="font-medium text-sm">{label}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        {description}
      </span>
    </button>
  );
}

export function StorageSubtypeSelector({ storageType, value, onChange }: StorageSubtypeSelectorProps) {
  // Special layout for cloud storage with labeled columns
  if (storageType === 'cloud') {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Select Provider
        </label>
        <div className="grid grid-cols-2 gap-4">
          {/* OAuth Providers column */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              OAuth Providers
            </span>
            <div className="space-y-2">
              {oauthProviders.map(({ subtype, label, description }) => (
                <ProviderButton
                  key={subtype}
                  subtype={subtype}
                  label={label}
                  description={description}
                  selected={value === subtype}
                  onClick={() => onChange(subtype)}
                />
              ))}
            </div>
          </div>
          {/* Object Storage column */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Object Storage
            </span>
            <div className="space-y-2">
              {objectStorage.map(({ subtype, label, description }) => (
                <ProviderButton
                  key={subtype}
                  subtype={subtype}
                  label={label}
                  description={description}
                  selected={value === subtype}
                  onClick={() => onChange(subtype)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const options = subtypes[storageType];

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Select Provider
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ subtype, label, description }) => (
          <ProviderButton
            key={subtype}
            subtype={subtype}
            label={label}
            description={description}
            selected={value === subtype}
            onClick={() => onChange(subtype)}
          />
        ))}
      </div>
    </div>
  );
}
