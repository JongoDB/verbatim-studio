import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface Project {
  id: string;
  name: string;
}

interface BulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onAssignProject: (projectId: string | null) => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  onDelete,
  onAssignProject,
  onClearSelection,
}: BulkActionBarProps) {
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (showProjectDropdown && projects.length === 0) {
      api.projects.list().then((res) => {
        setProjects(res.items || []);
      }).catch(() => {});
    }
  }, [showProjectDropdown, projects.length]);

  // Reset states when selection changes
  useEffect(() => {
    setConfirmDelete(false);
    setShowProjectDropdown(false);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-0 z-30 -mx-4 px-4 py-3 bg-card border-t border-border shadow-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>
          <button
            onClick={onClearSelection}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Assign to Project */}
          <div className="relative">
            <button
              onClick={() => { setShowProjectDropdown(!showProjectDropdown); setConfirmDelete(false); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Assign Project
            </button>
            {showProjectDropdown && (
              <div className="absolute bottom-full mb-1 right-0 w-48 rounded-lg border border-border bg-card shadow-lg py-1">
                <button
                  onClick={() => { onAssignProject(null); setShowProjectDropdown(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  No project
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onAssignProject(p.id); setShowProjectDropdown(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bulk Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-destructive">Delete {selectedCount}?</span>
              <button
                onClick={() => { onDelete(); setConfirmDelete(false); }}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setConfirmDelete(true); setShowProjectDropdown(false); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
