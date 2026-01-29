import type { MetadataField } from '@/lib/api';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
] as const;

interface MetadataFieldEditorProps {
  fields: MetadataField[];
  onChange: (fields: MetadataField[]) => void;
  disabled?: boolean;
}

export function MetadataFieldEditor({
  fields,
  onChange,
  disabled = false,
}: MetadataFieldEditorProps) {
  const addField = () => {
    const newField: MetadataField = {
      name: `field_${Date.now()}`,
      label: '',
      field_type: 'text',
      required: false,
    };
    onChange([...fields, newField]);
  };

  const updateField = (index: number, updates: Partial<MetadataField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };

    // Auto-generate name from label if name isn't manually set
    if (updates.label && !updated[index].name.startsWith('field_')) {
      // Keep existing name
    } else if (updates.label) {
      updated[index].name = updates.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    // Clear options if field type is not select
    if (updates.field_type && updates.field_type !== 'select') {
      delete updated[index].options;
    }

    onChange(updated);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const moveField = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= fields.length) return;
    const updated = [...fields];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onChange(updated);
  };

  const updateOptions = (index: number, optionsText: string) => {
    const options = optionsText
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    updateField(index, { options: options.length > 0 ? options : undefined });
  };

  return (
    <div className="space-y-4">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No custom fields. Click "Add Field" to create one.
        </p>
      )}

      {fields.map((field, index) => (
        <div
          key={index}
          className="border border-border rounded-lg p-4 space-y-3 bg-muted/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed p-1"
                disabled={disabled || index === 0}
                onClick={() => moveField(index, index - 1)}
                title="Move up"
              >
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                type="button"
                className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed p-1"
                disabled={disabled || index === fields.length - 1}
                onClick={() => moveField(index, index + 1)}
                title="Move down"
              >
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <span className="text-sm font-medium">Field {index + 1}</span>
            </div>
            <button
              type="button"
              onClick={() => removeField(index)}
              disabled={disabled}
              className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Label</label>
              <input
                value={field.label}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(index, { label: e.target.value })}
                placeholder="e.g., Case Number"
                disabled={disabled}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Type</label>
              <select
                value={field.field_type}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateField(index, {
                    field_type: e.target.value as MetadataField['field_type'],
                  })
                }
                disabled={disabled}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {field.field_type === 'select' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Options (comma-separated)</label>
              <input
                value={field.options?.join(', ') || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOptions(index, e.target.value)}
                placeholder="e.g., Option 1, Option 2, Option 3"
                disabled={disabled}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`required-${index}`}
              checked={field.required || false}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateField(index, { required: e.target.checked })
              }
              disabled={disabled}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor={`required-${index}`} className="text-xs text-foreground">
              Required field
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addField}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
      >
        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Field
      </button>
    </div>
  );
}
