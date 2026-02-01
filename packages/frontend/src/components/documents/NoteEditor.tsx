import { useState } from 'react'
import { AnchorBadge } from './AnchorBadge'

interface NoteEditorProps {
  initialContent?: string
  anchorType: 'page' | 'paragraph' | 'selection' | 'timestamp'
  anchorData: Record<string, unknown>
  onSave: (content: string) => void
  onCancel: () => void
  isLoading?: boolean
}

const textareaClasses = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
const buttonBaseClasses = "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
const primaryButtonClasses = `${buttonBaseClasses} bg-primary text-primary-foreground hover:bg-primary/90`
const ghostButtonClasses = `${buttonBaseClasses} text-muted-foreground hover:text-foreground hover:bg-muted`

export function NoteEditor({
  initialContent = '',
  anchorType,
  anchorData,
  onSave,
  onCancel,
  isLoading = false,
}: NoteEditorProps) {
  const [content, setContent] = useState(initialContent)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (content.trim()) {
      onSave(content.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 border border-border rounded-lg bg-card">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Anchor:</span>
        <AnchorBadge type={anchorType} data={anchorData} />
      </div>

      <textarea
        value={content}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
        placeholder="Write your note..."
        rows={3}
        autoFocus
        disabled={isLoading}
        className={textareaClasses}
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className={ghostButtonClasses}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!content.trim() || isLoading}
          className={primaryButtonClasses}
        >
          {isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  )
}
