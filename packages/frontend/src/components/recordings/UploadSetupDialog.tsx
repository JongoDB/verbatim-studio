import { useState, useEffect, useRef } from 'react';
import { api, type RecordingTemplate } from '@/lib/api';
import { DynamicMetadataForm } from '@/components/shared/DynamicMetadataForm';

export interface UploadOptions {
  title?: string;
  templateId?: string;
  metadata?: Record<string, unknown>;
  autoTranscribe?: boolean;
  autoGenerateSummary?: boolean;
}

interface UploadSetupDialogProps {
  isOpen: boolean;
  file: File | null;
  onClose: () => void;
  onConfirm: (options: UploadOptions) => void;
}

export function UploadSetupDialog({
  isOpen,
  file,
  onClose,
  onConfirm,
}: UploadSetupDialogProps) {
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<RecordingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [autoGenerateSummary, setAutoGenerateSummary] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Get selected template
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  // Reset state and load templates when dialog opens
  useEffect(() => {
    if (isOpen && file) {
      // Set default title from filename (without extension)
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      setTitle(fileName);
      setSelectedTemplateId(null);
      setMetadata({});
      loadTemplates();
    }
  }, [isOpen, file]);

  // Focus title input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.select(), 50);
    }
  }, [isOpen]);

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

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const handleConfirm = () => {
    onConfirm({
      title: title.trim() || undefined,
      templateId: selectedTemplateId || undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      autoTranscribe,
      autoGenerateSummary: autoTranscribe ? autoGenerateSummary : false,
    });
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId || null);
    // Clear metadata when template changes
    setMetadata({});
  };

  if (!isOpen || !file) return null;

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

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
          <h2 className="text-lg font-semibold text-foreground">Upload Recording</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* File Info */}
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                {file.type.startsWith('video/') ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                )}
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="upload-title" className="block text-sm font-medium text-foreground mb-1">
              Title
            </label>
            <input
              ref={titleRef}
              id="upload-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Recording title"
            />
          </div>

          {/* Recording Template */}
          <div>
            <label htmlFor="upload-template" className="block text-sm font-medium text-foreground mb-1">
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
                id="upload-template"
                value={selectedTemplateId || ''}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No template (General)</option>
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
              />
            </div>
          )}

          {/* Auto-transcribe checkbox */}
          <div className="border-t border-border pt-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoTranscribe}
                onChange={(e) => setAutoTranscribe(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <div>
                <span className="text-sm font-medium text-foreground">Transcribe after upload</span>
                <p className="text-xs text-muted-foreground">Automatically start transcription when upload completes</p>
              </div>
            </label>

            {/* Auto-generate summary checkbox */}
            <label className={`flex items-center gap-3 ${autoTranscribe ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
              <input
                type="checkbox"
                checked={autoGenerateSummary}
                onChange={(e) => setAutoGenerateSummary(e.target.checked)}
                disabled={!autoTranscribe}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">Generate AI summary</span>
                <p className="text-xs text-muted-foreground">Automatically create summary after transcription</p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
