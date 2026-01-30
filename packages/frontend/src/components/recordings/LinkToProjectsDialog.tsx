import { useState, useEffect } from 'react';
import { api, type Project } from '@/lib/api';

interface LinkToProjectsDialogProps {
  isOpen: boolean;
  selectedRecordingIds: string[];
  /** Map of recording ID to its current project IDs */
  recordingProjectMap: Record<string, string[]>;
  onClose: () => void;
  onLinked: () => void;
}

export function LinkToProjectsDialog({
  isOpen,
  selectedRecordingIds,
  recordingProjectMap,
  onClose,
  onLinked,
}: LinkToProjectsDialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Load projects when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);
      setSelectedProjectIds(new Set());
      api.projects.list()
        .then((res) => {
          setProjects(res.items || []);
        })
        .catch(() => {
          setError('Failed to load projects');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen]);

  // Calculate which projects already contain ALL selected recordings
  const projectContainsAll = (projectId: string): boolean => {
    return selectedRecordingIds.every(
      (recId) => recordingProjectMap[recId]?.includes(projectId)
    );
  };

  // Calculate which projects contain SOME (but not all) selected recordings
  const projectContainsSome = (projectId: string): boolean => {
    const count = selectedRecordingIds.filter(
      (recId) => recordingProjectMap[recId]?.includes(projectId)
    ).length;
    return count > 0 && count < selectedRecordingIds.length;
  };

  // Count how many selected recordings are in each project
  const getRecordingCountInProject = (projectId: string): number => {
    return selectedRecordingIds.filter(
      (recId) => recordingProjectMap[recId]?.includes(projectId)
    ).length;
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedProjectIds.size === 0) return;

    setSaving(true);
    setError(null);

    try {
      // For each selected project, add recordings that aren't already in it
      for (const projectId of selectedProjectIds) {
        for (const recordingId of selectedRecordingIds) {
          const alreadyIn = recordingProjectMap[recordingId]?.includes(projectId);
          if (!alreadyIn) {
            await api.projects.addRecording(projectId, recordingId);
          }
        }
      }
      onLinked();
      onClose();
    } catch {
      setError('Failed to link recordings to projects');
    } finally {
      setSaving(false);
    }
  };

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !saving) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  // Count total new links that will be created
  const newLinksCount = Array.from(selectedProjectIds).reduce((acc, projectId) => {
    return acc + selectedRecordingIds.filter(
      (recId) => !recordingProjectMap[recId]?.includes(projectId)
    ).length;
  }, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Link to Projects</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {selectedRecordingIds.length} recording{selectedRecordingIds.length !== 1 ? 's' : ''} selected
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="h-6 w-6 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No projects found. Create a project first.
            </p>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => {
                const containsAll = projectContainsAll(project.id);
                const containsSome = projectContainsSome(project.id);
                const countInProject = getRecordingCountInProject(project.id);
                const isSelected = selectedProjectIds.has(project.id);

                return (
                  <label
                    key={project.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                    } ${containsAll ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected || containsAll}
                      disabled={containsAll}
                      onChange={() => toggleProject(project.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {project.name}
                        </span>
                        {project.project_type && (
                          <span className="shrink-0 px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
                            {project.project_type.name}
                          </span>
                        )}
                      </div>
                      {/* Status indicator */}
                      {containsAll ? (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          All {selectedRecordingIds.length} recording{selectedRecordingIds.length !== 1 ? 's' : ''} already linked
                        </span>
                      ) : containsSome ? (
                        <span className="text-xs text-yellow-600 dark:text-yellow-400">
                          {countInProject} of {selectedRecordingIds.length} already linked
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {project.recording_count} recording{project.recording_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground">
            {newLinksCount > 0 ? `Will create ${newLinksCount} new link${newLinksCount !== 1 ? 's' : ''}` : 'Select projects to link'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || selectedProjectIds.size === 0 || newLinksCount === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Linking...' : `Link to ${selectedProjectIds.size} Project${selectedProjectIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
