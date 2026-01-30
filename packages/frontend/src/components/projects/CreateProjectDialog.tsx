import { useState, useEffect } from 'react';
import { DynamicMetadataForm } from '@/components/shared/DynamicMetadataForm';
import { TagInput } from '@/components/shared/TagInput';
import { api, type Project, type ProjectType } from '@/lib/api';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export function CreateProjectDialog({ isOpen, onClose, onCreated }: CreateProjectDialogProps) {
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    project_type_id: '',
    tags: [] as string[],
    metadata: {} as Record<string, unknown>,
  });

  // Load project types when dialog opens
  useEffect(() => {
    if (isOpen) {
      api.projectTypes.list()
        .then((res) => setProjectTypes(res.items))
        .catch(() => {});
    }
  }, [isOpen]);

  // Get selected type's schema
  const selectedTypeSchema = projectTypes.find(t => t.id === form.project_type_id)?.metadata_schema || [];

  // Extract unique tags from existing projects for suggestions
  const [existingTags, setExistingTags] = useState<string[]>([]);
  useEffect(() => {
    if (isOpen) {
      api.projects.list()
        .then((res) => {
          const tags = Array.from(
            new Set(
              res.items.flatMap(p => (p.metadata?.tags as string[]) || [])
            )
          ).sort();
          setExistingTags(tags);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      project_type_id: '',
      tags: [],
      metadata: {},
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setLoading(true);
    try {
      const metadata = {
        ...form.metadata,
        ...(form.tags.length > 0 ? { tags: form.tags } : {}),
      };
      const newProject = await api.projects.create({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        project_type_id: form.project_type_id || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      onCreated(newProject);
      onClose();
      resetForm();
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('bg-black/50')) {
          handleClose();
        }
      }}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Create Project</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Project name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
                disabled={loading}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Project description (optional)"
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                disabled={loading}
              />
            </div>

            {/* Project Type */}
            {projectTypes.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Project Type</label>
                <select
                  value={form.project_type_id}
                  onChange={(e) => setForm({ ...form, project_type_id: e.target.value, metadata: {} })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={loading}
                >
                  <option value="">No type</option>
                  {projectTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Dynamic Metadata Fields */}
            {selectedTypeSchema.length > 0 && (
              <DynamicMetadataForm
                fields={selectedTypeSchema}
                values={form.metadata}
                onChange={(metadata) => setForm({ ...form, metadata })}
              />
            )}

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Tags</label>
              <TagInput
                tags={form.tags}
                onChange={(tags) => setForm({ ...form, tags })}
                suggestions={existingTags}
                placeholder="Add tags..."
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || loading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
