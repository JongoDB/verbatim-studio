import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { AnchorBadge } from './AnchorBadge'
import { NoteEditor } from './NoteEditor'
import { Note } from '@/lib/api'

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  const months = Math.floor(days / 30);
  return rtf.format(-months, 'month');
}

interface NoteItemProps {
  note: Note
  onUpdate: (noteId: string, content: string) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
  onNavigate: (anchorType: string, anchorData: Record<string, unknown>) => void
}

export function NoteItem({ note, onUpdate, onDelete, onNavigate }: NoteItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSave = async (content: string) => {
    setIsLoading(true)
    try {
      await onUpdate(note.id, content)
      setIsEditing(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    setIsLoading(true)
    try {
      await onDelete(note.id)
    } finally {
      setIsLoading(false)
    }
  }

  if (isEditing) {
    return (
      <NoteEditor
        initialContent={note.content}
        anchorType={note.anchor_type as 'page' | 'paragraph' | 'selection' | 'timestamp'}
        anchorData={note.anchor_data}
        onSave={handleSave}
        onCancel={() => setIsEditing(false)}
        isLoading={isLoading}
      />
    )
  }

  return (
    <div className="group p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onNavigate(note.anchor_type, note.anchor_data)}
          className="flex-1 text-left"
        >
          <AnchorBadge
            type={note.anchor_type as 'page' | 'paragraph' | 'selection' | 'timestamp'}
            data={note.anchor_data}
            className="mb-2"
          />
          <p className="text-sm line-clamp-3">{note.content}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatTimeAgo(note.created_at)}
          </p>
        </button>

        {/* Simple dropdown menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] bg-popover border border-border rounded-md shadow-md py-1">
                <button
                  onClick={() => { setIsEditing(true); setMenuOpen(false); }}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
                <button
                  onClick={() => { handleDelete(); setMenuOpen(false); }}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
