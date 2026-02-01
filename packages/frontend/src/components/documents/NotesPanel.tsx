import { useState, useEffect } from 'react'
import { Plus, MessageSquare, X } from 'lucide-react'
import { NoteItem } from './NoteItem'
import { NoteEditor } from './NoteEditor'
import { api, Note } from '@/lib/api'

interface NotesPanelProps {
  documentId: string
  currentPage?: number
  currentParagraph?: number
  selectedText?: { text: string; start: number; end: number } | null
  onNavigateToAnchor: (anchorType: string, anchorData: Record<string, unknown>) => void
  onClose?: () => void
  pendingAnchor?: { type: 'selection'; data: { text: string; page: number } } | null
  onPendingAnchorUsed?: () => void
}

export function NotesPanel({
  documentId,
  currentPage = 1,
  currentParagraph,
  selectedText,
  onNavigateToAnchor,
  onClose,
  pendingAnchor,
  onPendingAnchorUsed,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Determine anchor for new notes
  const newNoteAnchor = (() => {
    // Use pending anchor from text selection if available
    if (pendingAnchor) {
      return pendingAnchor
    }
    if (selectedText) {
      return {
        type: 'selection' as const,
        data: { text: selectedText.text, start: selectedText.start, end: selectedText.end },
      }
    }
    if (currentParagraph !== undefined) {
      return { type: 'paragraph' as const, data: { paragraph: currentParagraph } }
    }
    return { type: 'page' as const, data: { page: currentPage } }
  })()

  // Auto-start note creation when pending anchor is provided
  useEffect(() => {
    if (pendingAnchor && !isCreating) {
      setIsCreating(true)
    }
  }, [pendingAnchor])

  const fetchNotes = async () => {
    try {
      setIsLoading(true)
      const response = await api.notes.list({ document_id: documentId })
      setNotes(response.items)
      setError(null)
    } catch (e) {
      setError('Failed to load notes')
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchNotes()
  }, [documentId])

  const handleCreate = async (content: string) => {
    try {
      const newNote = await api.notes.create({
        document_id: documentId,
        content,
        anchor_type: newNoteAnchor.type,
        anchor_data: newNoteAnchor.data,
      })
      setNotes((prev) => [newNote, ...prev])
      setIsCreating(false)
      // Clear the pending anchor after creating the note
      onPendingAnchorUsed?.()
    } catch (e) {
      console.error('Failed to create note:', e)
    }
  }

  const handleUpdate = async (noteId: string, content: string) => {
    try {
      const updated = await api.notes.update(noteId, { content })
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)))
    } catch (e) {
      console.error('Failed to update note:', e)
    }
  }

  const handleDelete = async (noteId: string) => {
    try {
      await api.notes.delete(noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch (e) {
      console.error('Failed to delete note:', e)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="font-medium">Notes</span>
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {notes.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCreating(true)}
            disabled={isCreating}
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-3">
          {isCreating && (
            <NoteEditor
              anchorType={newNoteAnchor.type}
              anchorData={newNoteAnchor.data}
              onSave={handleCreate}
              onCancel={() => {
                setIsCreating(false)
                onPendingAnchorUsed?.()
              }}
            />
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading notes...</p>
          ) : error ? (
            <p className="text-sm text-destructive text-center py-4">{error}</p>
          ) : notes.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No notes yet</p>
              <button
                onClick={() => setIsCreating(true)}
                className="text-sm text-primary hover:underline mt-1"
              >
                Add your first note
              </button>
            </div>
          ) : (
            notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onNavigate={onNavigateToAnchor}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
