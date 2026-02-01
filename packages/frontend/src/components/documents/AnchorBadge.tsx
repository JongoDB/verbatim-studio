import { FileText, Hash, MousePointer, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AnchorBadgeProps {
  type: 'page' | 'paragraph' | 'selection' | 'timestamp'
  data: Record<string, unknown>
  className?: string
}

const icons = {
  page: FileText,
  paragraph: Hash,
  selection: MousePointer,
  timestamp: Clock,
}

export function AnchorBadge({ type, data, className }: AnchorBadgeProps) {
  const Icon = icons[type] || FileText

  const label = (() => {
    switch (type) {
      case 'page':
        return `Page ${data.page}`
      case 'paragraph':
        return `¶${data.paragraph}`
      case 'selection':
        return data.text ? `"${String(data.text).slice(0, 20)}..."` : 'Selection'
      case 'timestamp':
        return `${data.time}s`
      default:
        return type
    }
  })()

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        'bg-muted px-1.5 py-0.5 rounded',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
