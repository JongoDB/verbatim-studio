import { useState, useCallback, useRef, useEffect } from 'react';
import { api, type Project, type OCRStatusResponse } from '@/lib/api';

interface UploadDocumentDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  projects?: Project[];
  defaultProjectId?: string;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'text/plain',
  'text/markdown',
].join(',');

export function UploadDocumentDialog({
  open,
  onClose,
  onUploaded,
  projects = [],
  defaultProjectId,
}: UploadDocumentDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [enableOcr, setEnableOcr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [screenshotDelay, setScreenshotDelay] = useState(0);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ocrStatus, setOcrStatus] = useState<OCRStatusResponse | null>(null);

  // Fetch OCR status when dialog opens and when OCR model is downloaded
  useEffect(() => {
    const fetchOcrStatus = () => api.ocr.status().then(setOcrStatus).catch(() => setOcrStatus(null));
    if (open) {
      fetchOcrStatus();
      window.addEventListener('ocr-status-changed', fetchOcrStatus);
      return () => window.removeEventListener('ocr-status-changed', fetchOcrStatus);
    }
  }, [open]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const doCapture = useCallback(async () => {
    if (!window.electronAPI?.captureScreenshot) return;
    try {
      const result = await window.electronAPI.captureScreenshot();
      if (result.data) {
        const byteString = atob(result.data);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/png' });
        const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        setFiles((prev) => [...prev, file]);
      }
    } catch (err) {
      console.error('Screenshot capture failed:', err);
    }
  }, []);

  const handleScreenshot = useCallback(async () => {
    if (!window.electronAPI?.captureScreenshot) return;
    setIsCapturing(true);
    try {
      if (screenshotDelay > 0) {
        // Countdown in the UI so user can switch windows
        for (let i = screenshotDelay; i > 0; i--) {
          setCountdown(i);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCountdown(0);
      }
      await doCapture();
    } finally {
      setIsCapturing(false);
    }
  }, [screenshotDelay, doCapture]);

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setErrors({});

    for (const file of files) {
      try {
        setProgress((prev) => ({ ...prev, [file.name]: 0 }));
        await api.documents.upload(file, file.name, projectId || undefined, enableOcr);
        setProgress((prev) => ({ ...prev, [file.name]: 100 }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [file.name]: err instanceof Error ? err.message : 'Upload failed',
        }));
      }
    }

    setUploading(false);
    onUploaded();
    onClose();
    setFiles([]);
    setProgress({});
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Upload Documents
        </h2>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
        >
          <svg className="w-10 h-10 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Drag and drop files here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Screenshot capture - Electron only */}
        {window.electronAPI?.captureScreenshot && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleScreenshot}
              disabled={uploading || isCapturing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
              {countdown > 0
                ? `${countdown}\u2026`
                : isCapturing
                  ? 'Capturing\u2026'
                  : 'Take Screenshot'}
            </button>
            <select
              value={screenshotDelay}
              onChange={(e) => setScreenshotDelay(Number(e.target.value))}
              disabled={uploading || isCapturing}
              className="px-2 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
              title="Delay before capture"
            >
              <option value={0}>No delay</option>
              <option value={3}>3s delay</option>
              <option value={5}>5s delay</option>
            </select>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4 space-y-2 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    {file.name}
                  </p>
                  {progress[file.name] !== undefined && (
                    <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${progress[file.name]}%` }}
                      />
                    </div>
                  )}
                  {errors[file.name] && (
                    <p className="text-xs text-red-500 mt-1">{errors[file.name]}</p>
                  )}
                </div>
                {!uploading && (
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-2 p-1 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Project selector */}
        {projects.length > 0 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Add to Project (optional)
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* OCR toggle */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Enable OCR
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {ocrStatus?.available
                ? 'Extract text from images and scanned PDFs using AI vision'
                : 'Download OCR model in Settings → AI to enable'}
            </p>
          </div>
          <label
            className={`relative inline-flex items-center ${ocrStatus?.available ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            title={!ocrStatus?.available ? 'Download OCR model in Settings → AI to enable OCR' : undefined}
          >
            <input
              type="checkbox"
              checked={enableOcr}
              onChange={(e) => setEnableOcr(e.target.checked)}
              disabled={!ocrStatus?.available}
              className="sr-only peer"
            />
            <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600 ${!ocrStatus?.available ? 'opacity-50' : ''}`} />
          </label>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
