import { useState, useRef, useEffect } from 'react';
import { api, type ExportFormat } from '@/lib/api';

interface ExportButtonProps {
  transcriptId: string;
  title?: string;
}

const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'txt', label: 'Plain Text (.txt)', description: 'Simple text with timestamps' },
  { value: 'srt', label: 'SubRip (.srt)', description: 'Subtitle format for video players' },
  { value: 'vtt', label: 'WebVTT (.vtt)', description: 'Web subtitle format' },
  { value: 'docx', label: 'Word (.docx)', description: 'Microsoft Word document' },
  { value: 'pdf', label: 'PDF (.pdf)', description: 'Portable Document Format' },
];

export function ExportButton({ transcriptId, title }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    setExportFormat(format);
    setIsOpen(false);

    try {
      const blob = await api.transcripts.export(transcriptId, { format });

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Generate filename
      const baseName = title || 'transcript';
      const safeName = baseName.replace(/[^a-zA-Z0-9 \-_]/g, '_');
      a.download = `${safeName}.${format}`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      setExportFormat(null);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isExporting ? (
          <>
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Exporting {exportFormat?.toUpperCase()}...
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-50">
          <div className="p-2">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Export Format
            </div>
            {EXPORT_FORMATS.map((format) => (
              <button
                key={format.value}
                onClick={() => handleExport(format.value)}
                className="w-full flex flex-col items-start px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {format.label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {format.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
