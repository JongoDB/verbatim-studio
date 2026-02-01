import { useState, useEffect, useRef } from 'react';
import { api, type Recording, type Document } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export type AttachmentType = 'transcript' | 'document' | 'file';

export interface ChatAttachment {
  id: string;
  type: AttachmentType;
  title: string;
  recordingId?: string;
  documentId?: string;
  fileText?: string;  // For temporary file uploads
}

interface AttachmentPickerProps {
  attached: ChatAttachment[];
  onAttach: (attachment: ChatAttachment) => void;
  onDetach: (id: string) => void;
  onClose: () => void;
}

type TabType = 'transcripts' | 'documents' | 'upload';

export function AttachmentPicker({ attached, onAttach, onDetach, onClose }: AttachmentPickerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('transcripts');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [search, setSearch] = useState('');
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.recordings.list({ status: 'completed', pageSize: 50 })
      .then((r) => setRecordings(r.items))
      .catch(() => {})
      .finally(() => setLoadingRecordings(false));

    api.documents.list({ status: 'completed' })
      .then((r) => setDocuments(r.items))
      .catch(() => {})
      .finally(() => setLoadingDocuments(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const attachedIds = new Set(attached.map((a) => a.id));

  const filteredRecordings = recordings.filter(
    (r) => r.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredDocuments = documents.filter(
    (d) => d.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleRecording = (recording: Recording) => {
    const attachmentId = `transcript-${recording.id}`;
    if (attachedIds.has(attachmentId)) {
      onDetach(attachmentId);
    } else {
      if (attached.length >= 5) {
        alert('Maximum 5 attachments. Remove one before adding more.');
        return;
      }
      onAttach({
        id: attachmentId,
        type: 'transcript',
        title: recording.title,
        recordingId: recording.id,
      });
    }
  };

  const handleToggleDocument = (doc: Document) => {
    const attachmentId = `document-${doc.id}`;
    if (attachedIds.has(attachmentId)) {
      onDetach(attachmentId);
    } else {
      if (attached.length >= 5) {
        alert('Maximum 5 attachments. Remove one before adding more.');
        return;
      }
      onAttach({
        id: attachmentId,
        type: 'document',
        title: doc.title,
        documentId: doc.id,
      });
    }
  };

  const [isExtracting, setIsExtracting] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    if (attached.length >= 5) {
      setUploadError('Maximum 5 attachments. Remove one before adding more.');
      return;
    }

    // Check file size (max 20MB for server-side extraction)
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File too large. Maximum 20MB for chat attachments.');
      return;
    }

    setIsExtracting(true);

    try {
      let text = '';

      // For simple text files, read directly (faster)
      if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
        text = await file.text();
      } else {
        // Use backend extraction for PDFs, Office docs, images, etc.
        const result = await api.ai.extractText(file);
        text = result.text;
      }

      // Truncate if too long
      if (text.length > 50000) {
        text = text.slice(0, 50000) + '\n\n[Text truncated at 50,000 characters]';
      }

      if (!text.trim()) {
        setUploadError('Could not extract text from file.');
        return;
      }

      const attachmentId = `file-${Date.now()}`;
      onAttach({
        id: attachmentId,
        type: 'file',
        title: file.name,
        fileText: text,
      });

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to extract text from file.');
    } finally {
      setIsExtracting(false);
    }
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'transcripts', label: 'Transcripts' },
    { key: 'documents', label: 'Documents' },
    { key: 'upload', label: 'Upload' },
  ];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Attach files"
      className="absolute bottom-full left-0 mb-2 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-96 overflow-hidden flex flex-col"
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search (for transcripts and documents tabs) */}
      {activeTab !== 'upload' && (
        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            aria-label={`Search ${activeTab}`}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'transcripts' && (
          loadingRecordings ? (
            <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
          ) : filteredRecordings.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">No transcripts found</div>
          ) : (
            filteredRecordings.slice(0, 20).map((recording) => {
              const attachmentId = `transcript-${recording.id}`;
              return (
                <label
                  key={recording.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={attachedIds.has(attachmentId)}
                    onChange={() => handleToggleRecording(recording)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {recording.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(recording.created_at)}
                    </p>
                  </div>
                </label>
              );
            })
          )
        )}

        {activeTab === 'documents' && (
          loadingDocuments ? (
            <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">No documents found</div>
          ) : (
            filteredDocuments.slice(0, 20).map((doc) => {
              const attachmentId = `document-${doc.id}`;
              return (
                <label
                  key={doc.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={attachedIds.has(attachmentId)}
                    onChange={() => handleToggleDocument(doc)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {doc.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(doc.created_at)}
                    </p>
                  </div>
                </label>
              );
            })
          )
        )}

        {activeTab === 'upload' && (
          <div className="p-4">
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
              {isExtracting ? (
                <>
                  <svg className="w-8 h-8 mx-auto text-blue-500 mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Extracting text...
                  </p>
                </>
              ) : (
                <>
                  <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Upload a file for temporary context
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.json,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.tiff"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="chat-file-upload"
                  />
                  <label
                    htmlFor="chat-file-upload"
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
                  >
                    Choose File
                  </label>
                  <p className="text-xs text-gray-400 mt-2">
                    PDF, Word, Excel, PowerPoint, images, text (max 20MB)
                  </p>
                  {uploadError && (
                    <p className="text-xs text-red-500 mt-2">{uploadError}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Currently attached */}
      {attached.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-2">
          <p className="text-xs text-gray-500 mb-1">Attached ({attached.length}/5):</p>
          <div className="flex flex-wrap gap-1">
            {attached.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
              >
                {a.type === 'transcript' && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
                {a.type === 'document' && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {a.type === 'file' && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                )}
                <span className="truncate max-w-24">{a.title}</span>
                <button
                  onClick={() => onDetach(a.id)}
                  className="hover:text-red-500"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
