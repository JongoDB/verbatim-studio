import { FileText, Image, Table2, Presentation, File, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  'application/pdf': { icon: FileText, color: 'text-red-500' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: FileText, color: 'text-blue-500' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: Table2, color: 'text-green-600' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { icon: Presentation, color: 'text-orange-500' },
  'image/png': { icon: Image, color: 'text-purple-500' },
  'image/jpeg': { icon: Image, color: 'text-purple-500' },
  'image/tiff': { icon: Image, color: 'text-purple-500' },
  'image/webp': { icon: Image, color: 'text-purple-500' },
  'text/plain': { icon: File, color: 'text-gray-500 dark:text-gray-400' },
  'text/markdown': { icon: File, color: 'text-gray-500 dark:text-gray-400' },
};

function getConfig(mimeType: string): { icon: LucideIcon; color: string } {
  if (ICON_CONFIG[mimeType]) return ICON_CONFIG[mimeType];
  if (mimeType.startsWith('image/')) return ICON_CONFIG['image/png'];
  if (mimeType.startsWith('text/')) return ICON_CONFIG['text/plain'];
  return { icon: FileText, color: 'text-gray-400' };
}

interface DocumentTypeIconProps {
  mimeType: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function DocumentTypeIcon({ mimeType, size = 'md', className }: DocumentTypeIconProps) {
  const { icon: Icon, color } = getConfig(mimeType);
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';

  return <Icon className={cn(sizeClass, color, className)} strokeWidth={1.5} />;
}
