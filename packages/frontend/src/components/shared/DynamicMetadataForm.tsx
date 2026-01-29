import type { MetadataField } from '@/lib/api';

interface DynamicMetadataFormProps {
  fields: MetadataField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function DynamicMetadataForm({
  fields,
  values,
  onChange,
  disabled = false,
}: DynamicMetadataFormProps) {
  const handleFieldChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No custom fields defined.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <label htmlFor={field.name} className="block text-sm font-medium text-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>

          {field.field_type === 'text' && (
            <input
              id={field.name}
              type="text"
              value={(values[field.name] as string) || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.default_value || ''}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          )}

          {field.field_type === 'number' && (
            <input
              id={field.name}
              type="number"
              value={(values[field.name] as string) || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.default_value || ''}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          )}

          {field.field_type === 'date' && (
            <input
              id={field.name}
              type="date"
              value={(values[field.name] as string) || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(field.name, e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          )}

          {field.field_type === 'textarea' && (
            <textarea
              id={field.name}
              value={(values[field.name] as string) || ''}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.default_value || ''}
              rows={3}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-none"
            />
          )}

          {field.field_type === 'select' && field.options && (
            <select
              id={field.name}
              value={(values[field.name] as string) || ''}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFieldChange(field.name, e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              <option value="">Select {field.label.toLowerCase()}</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
