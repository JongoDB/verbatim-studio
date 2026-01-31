import { HardDrive, Server, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StorageType } from '@/lib/api';

interface StorageTypeSelectorProps {
  value: StorageType;
  onChange: (type: StorageType) => void;
}

const types: { type: StorageType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    type: 'local',
    label: 'Local Storage',
    description: 'Folder on this computer',
    icon: <HardDrive className="w-8 h-8" />,
  },
  {
    type: 'network',
    label: 'Network Storage',
    description: 'SMB or NFS share',
    icon: <Server className="w-8 h-8" />,
  },
  {
    type: 'cloud',
    label: 'Cloud Storage',
    description: 'S3, Google Drive, etc.',
    icon: <Cloud className="w-8 h-8" />,
  },
];

export function StorageTypeSelector({ value, onChange }: StorageTypeSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {types.map(({ type, label, description, icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={cn(
            'flex flex-col items-center p-4 rounded-lg border-2 transition-all',
            'hover:border-primary hover:bg-primary/5',
            value === type
              ? 'border-primary bg-primary/10'
              : 'border-gray-200 dark:border-gray-700'
          )}
        >
          <div className={cn(
            'mb-2',
            value === type ? 'text-primary' : 'text-gray-500 dark:text-gray-400'
          )}>
            {icon}
          </div>
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
            {description}
          </span>
        </button>
      ))}
    </div>
  );
}
