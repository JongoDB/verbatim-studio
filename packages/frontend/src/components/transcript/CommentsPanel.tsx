import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SegmentComment } from '@/lib/api';

interface CommentsPanelProps {
  segmentId: string;
  onCommentCountChange: (segmentId: string, delta: number) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CommentsPanel({ segmentId, onCommentCountChange }: CommentsPanelProps) {
  const [comments, setComments] = useState<SegmentComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.comments.list(segmentId);
      setComments(data.items);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [segmentId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleAdd = async () => {
    const trimmed = newText.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const comment = await api.comments.create(segmentId, trimmed);
      setComments((prev) => [...prev, comment]);
      setNewText('');
      onCommentCountChange(segmentId, 1);
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (commentId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const updated = await api.comments.update(commentId, trimmed);
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      setEditingId(null);
      setEditingText('');
    } catch (err) {
      console.error('Failed to update comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (submitting) return;

    setSubmitting(true);
    try {
      await api.comments.delete(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      onCommentCountChange(segmentId, -1);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      action();
    }
    if (e.key === 'Escape') {
      if (editingId) {
        setEditingId(null);
        setEditingText('');
      }
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
      {/* Comments list */}
      {loading ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No comments yet</p>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-2 mb-2">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="flex items-start gap-2 text-sm"
            >
              {editingId === comment.id ? (
                <div className="flex-1">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, () => handleUpdate(comment.id))}
                    className="w-full p-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    rows={2}
                    disabled={submitting}
                    autoFocus
                  />
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => handleUpdate(comment.id)}
                      disabled={submitting}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditingText(''); }}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="flex-1 text-gray-700 dark:text-gray-300 text-xs leading-relaxed">
                    {comment.text}
                  </p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {formatRelativeTime(comment.created_at)}
                    </span>
                    <button
                      onClick={() => { setEditingId(comment.id); setEditingText(comment.text); }}
                      className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                      title="Edit"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                      title="Delete"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add comment form */}
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, handleAdd)}
          placeholder="Add a comment..."
          className="flex-1 p-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400"
          rows={1}
          disabled={submitting}
        />
        <button
          onClick={handleAdd}
          disabled={!newText.trim() || submitting}
          className="self-end px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
