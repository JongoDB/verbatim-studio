import { useState, useEffect, useCallback, useRef } from 'react';
import { MetadataFieldEditor } from '@/components/shared/MetadataFieldEditor';
import { api, type RecordingTemplate, type MetadataField } from '@/lib/api';

interface RecordingTemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplatesChange?: () => void;
}

export function RecordingTemplateManager({
  open,
  onOpenChange,
  onTemplatesChange,
}: RecordingTemplateManagerProps) {
  const [templates, setTemplates] = useState<RecordingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form state
  const [selectedTemplate, setSelectedTemplate] =
    useState<RecordingTemplate | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    metadata_schema: [] as MetadataField[],
  });

  // Load templates
  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.recordingTemplates.list();
      setTemplates(res.items);
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open, loadTemplates]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (deleteDialogOpen) {
          setDeleteDialogOpen(false);
        } else if (editDialogOpen) {
          setEditDialogOpen(false);
        } else {
          onOpenChange(false);
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, editDialogOpen, deleteDialogOpen, onOpenChange]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onOpenChange(false);
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      metadata_schema: [],
    });
  };

  const handleCreate = async () => {
    try {
      await api.recordingTemplates.create({
        name: form.name,
        description: form.description || null,
        metadata_schema: form.metadata_schema,
      });
      resetForm();
      loadTemplates();
      onTemplatesChange?.();
    } catch (error) {
      console.error('Failed to create template:', error);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTemplate) return;
    try {
      await api.recordingTemplates.update(selectedTemplate.id, {
        name: form.name,
        description: form.description || null,
        metadata_schema: form.metadata_schema,
      });
      setEditDialogOpen(false);
      setSelectedTemplate(null);
      resetForm();
      loadTemplates();
      onTemplatesChange?.();
    } catch (error) {
      console.error('Failed to update template:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;
    try {
      await api.recordingTemplates.delete(selectedTemplate.id);
      setDeleteDialogOpen(false);
      setSelectedTemplate(null);
      loadTemplates();
      onTemplatesChange?.();
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  const openEditDialog = (template: RecordingTemplate) => {
    setSelectedTemplate(template);
    setForm({
      name: template.name,
      description: template.description || '',
      metadata_schema: template.metadata_schema,
    });
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (template: RecordingTemplate) => {
    setSelectedTemplate(template);
    setDeleteDialogOpen(true);
  };

  if (!open) return null;

  return (
    <>
      {/* Main Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h2 className="text-lg font-semibold text-foreground">Manage Recording Templates</h2>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            >
              <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Recording templates define custom metadata fields for your recordings.
            </p>

            {/* Create new template form */}
            <div className="border border-border rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-foreground">Create New Template</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Name</label>
                  <input
                    value={form.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="Template name"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Description</label>
                  <input
                    value={form.description}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Optional description"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Custom Fields</label>
                <MetadataFieldEditor
                  fields={form.metadata_schema}
                  onChange={(metadata_schema) =>
                    setForm({ ...form, metadata_schema })
                  }
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim()}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Create Template
              </button>
            </div>

            {/* Existing templates */}
            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Existing Templates</h4>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recording templates yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between border border-border rounded-lg p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{template.name}</span>
                          {template.is_system && (
                            <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground">
                              System
                            </span>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {template.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {template.metadata_schema.length} fields · {template.recording_count} recordings
                        </p>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => openEditDialog(template)}
                          className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        >
                          <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {!template.is_system && (
                          <button
                            onClick={() => openDeleteDialog(template)}
                            className="p-2 rounded-md hover:bg-destructive/10 transition-colors text-destructive"
                          >
                            <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-5 py-4 border-t border-border sticky bottom-0 bg-card">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Edit Template Dialog */}
      {editDialogOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains('bg-black/50')) {
              setEditDialogOpen(false);
            }
          }}
        >
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Edit Recording Template</h2>
              <button
                onClick={() => setEditDialogOpen(false)}
                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
              >
                <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Name</label>
                <input
                  value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Description</label>
                <input
                  value={form.description}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Custom Fields</label>
                <MetadataFieldEditor
                  fields={form.metadata_schema}
                  onChange={(metadata_schema) =>
                    setForm({ ...form, metadata_schema })
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setEditDialogOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={!form.name.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Template Dialog */}
      {deleteDialogOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains('bg-black/50')) {
              setDeleteDialogOpen(false);
            }
          }}
        >
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-5 py-4">
              <h2 className="text-lg font-semibold text-foreground">Delete Recording Template</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Are you sure you want to delete "{selectedTemplate?.name}"?
                Recordings using this template will have their template unassigned.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setDeleteDialogOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
