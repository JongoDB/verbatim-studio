import { useState, useRef, useEffect } from 'react';
import { api, type Recording, type Tag, type RecordingTemplate } from '@/lib/api';
import { DynamicMetadataForm } from '@/components/shared/DynamicMetadataForm';

interface EditRecordingDialogProps {
  isOpen: boolean;
  recording: Recording | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditRecordingDialog({
  isOpen,
  recording,
  onClose,
  onSaved,
}: EditRecordingDialogProps) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Tags state
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [recordingTagIds, setRecordingTagIds] = useState<Set<string>>(new Set());
  const [originalTagIds, setOriginalTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState('');
  const [loadingTags, setLoadingTags] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<RecordingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [originalTemplateId, setOriginalTemplateId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [originalMetadata, setOriginalMetadata] = useState<Record<string, unknown>>({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Get selected template
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  // Load recording data when dialog opens
  useEffect(() => {
    if (isOpen && recording) {
      setTitle(recording.title);
      setSelectedTemplateId(recording.template_id);
      setOriginalTemplateId(recording.template_id);
      setMetadata(recording.metadata || {});
      setOriginalMetadata(recording.metadata || {});
      setError(null);
      setSaving(false);
      loadTags();
      loadTemplates();
    }
  }, [isOpen, recording]);

  const loadTags = async () => {
    if (!recording) return;
    setLoadingTags(true);
    try {
      const [tagsRes, recordingTagsRes] = await Promise.all([
        api.tags.list(),
        api.tags.forRecording(recording.id),
      ]);
      setAllTags(tagsRes.items);
      const tagIds = new Set(recordingTagsRes.items.map(t => t.id));
      setRecordingTagIds(tagIds);
      setOriginalTagIds(new Set(tagIds));
    } catch {
      console.error('Failed to load tags');
    } finally {
      setLoadingTags(false);
    }
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await api.recordingTemplates.list();
      setTemplates(res.items);
    } catch {
      console.error('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    const newTemplateId = templateId || null;
    setSelectedTemplateId(newTemplateId);
    // Keep existing metadata values that match new template fields
    // (metadata is preserved, new template just shows different fields)
  };

  // Focus title input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.select(), 50);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !saving) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, saving, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node) && !saving) {
      onClose();
    }
  };

  const toggleTag = (tagId: string) => {
    setRecordingTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const tag = await api.tags.create(name);
      setAllTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setRecordingTagIds(prev => new Set([...prev, tag.id]));
      setNewTagName('');
    } catch {
      // Tag may already exist
    }
  };

  const handleSave = async () => {
    if (!recording) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Build update payload
      const updates: {
        title?: string;
        template_id?: string | null;
        metadata?: Record<string, unknown>;
      } = {};

      // Update title if changed
      if (trimmed !== recording.title) {
        updates.title = trimmed;
      }

      // Update template if changed
      if (selectedTemplateId !== originalTemplateId) {
        updates.template_id = selectedTemplateId;
      }

      // Update metadata if changed
      if (JSON.stringify(metadata) !== JSON.stringify(originalMetadata)) {
        updates.metadata = metadata;
      }

      // Only call API if there are changes
      if (Object.keys(updates).length > 0) {
        await api.recordings.update(recording.id, updates);
      }

      // Update tags
      const toAdd = [...recordingTagIds].filter(id => !originalTagIds.has(id));
      const toRemove = [...originalTagIds].filter(id => !recordingTagIds.has(id));

      for (const tagId of toAdd) {
        await api.tags.assign(recording.id, tagId);
      }
      for (const tagId of toRemove) {
        await api.tags.remove(recording.id, tagId);
      }

      onSaved();
      onClose();
    } catch {
      setError('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !recording) return null;

  const hasChanges = title.trim() !== recording.title ||
    [...recordingTagIds].some(id => !originalTagIds.has(id)) ||
    [...originalTagIds].some(id => !recordingTagIds.has(id)) ||
    selectedTemplateId !== originalTemplateId ||
    JSON.stringify(metadata) !== JSON.stringify(originalMetadata);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Edit Recording</h2>
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
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <label htmlFor="edit-title" className="block text-sm font-medium text-foreground mb-1">
              Title
            </label>
            <input
              ref={titleRef}
              id="edit-title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              disabled={saving}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* Recording Template */}
          <div>
            <label htmlFor="edit-template" className="block text-sm font-medium text-foreground mb-1">
              Recording Type
            </label>
            {loadingTemplates ? (
              <div className="flex items-center justify-center py-2">
                <svg className="h-5 w-5 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : (
              <select
                id="edit-template"
                value={selectedTemplateId || ''}
                onChange={(e) => handleTemplateChange(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            )}
            {selectedTemplate?.description && (
              <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate.description}</p>
            )}
          </div>

          {/* Template Metadata Fields */}
          {selectedTemplate && selectedTemplate.metadata_schema.length > 0 && (
            <div className="border-t border-border pt-4">
              <h4 className="text-sm font-medium text-foreground mb-3">
                {selectedTemplate.name} Fields
              </h4>
              <DynamicMetadataForm
                fields={selectedTemplate.metadata_schema}
                values={metadata}
                onChange={setMetadata}
                disabled={saving}
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Tags
            </label>

            {loadingTags ? (
              <div className="flex items-center justify-center py-4">
                <svg className="h-5 w-5 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : (
              <>
                {/* Create new tag */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
                    placeholder="New tag name..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={handleCreateTag}
                    disabled={!newTagName.trim()}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                {/* Tag list */}
                {allTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No tags yet. Create one above.
                  </p>
                ) : (
                  <div className="border border-border rounded-lg max-h-40 overflow-y-auto">
                    {allTags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b border-border last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={recordingTagIds.has(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {tag.color && (
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                          )}
                          <span className="text-sm text-foreground truncate">{tag.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {/* Selected tags display */}
                {recordingTagIds.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {[...recordingTagIds].map((tagId) => {
                      const tag = allTags.find(t => t.id === tagId);
                      if (!tag) return null;
                      return (
                        <span
                          key={tagId}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary"
                        >
                          {tag.color && (
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          )}
                          {tag.name}
                          <button
                            onClick={() => toggleTag(tagId)}
                            className="ml-0.5 hover:text-primary/70"
                          >
                            <svg className="h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
