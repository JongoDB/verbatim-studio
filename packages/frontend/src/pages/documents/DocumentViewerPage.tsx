import { useState, useEffect } from 'react';
import { api, type Document } from '@/lib/api';

interface DocumentViewerPageProps {
  documentId: string;
  onBack: () => void;
}

export function DocumentViewerPage({ documentId, onBack }: DocumentViewerPageProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const doc = await api.documents.get(documentId);
        setDocument(doc);

        // Only fetch text content for non-visual documents (not PDFs or images)
        // PDFs and images are displayed directly via iframe/img tags
        const isPdf = doc.mime_type === 'application/pdf';
        const isImage = doc.mime_type.startsWith('image/');

        if (doc.status === 'completed' && !isPdf && !isImage) {
          try {
            const contentRes = await api.documents.getContent(documentId);
            setContent(contentRes.content);
          } catch {
            // Content extraction may not be available for all document types
            setContent(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">{error || 'Document not found'}</p>
        <button onClick={onBack} className="mt-4 text-blue-500 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const isPdf = document.mime_type === 'application/pdf';
  const isImage = document.mime_type.startsWith('image/');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {document.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {document.filename} • {document.status}
          </p>
        </div>
        <a
          href={api.documents.getFileUrl(documentId)}
          download={document.filename}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </a>
      </div>

      {/* Content */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {document.status === 'processing' && (
          <div className="p-8 text-center">
            <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Processing document...</p>
          </div>
        )}

        {document.status === 'failed' && (
          <div className="p-8 text-center">
            <p className="text-red-500">Processing failed: {document.error_message}</p>
            <button
              onClick={() => api.documents.reprocess(documentId)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Retry Processing
            </button>
          </div>
        )}

        {document.status === 'completed' && (
          <>
            {isPdf && (
              <iframe
                src={api.documents.getFileUrl(documentId, true)}
                className="w-full h-[calc(100vh-260px)]"
                title={document.title}
              />
            )}

            {isImage && (
              <div className="p-4 flex items-center justify-center">
                <img
                  src={api.documents.getFileUrl(documentId, true)}
                  alt={document.title}
                  className="max-w-full max-h-[calc(100vh-200px)] object-contain"
                />
              </div>
            )}

            {!isPdf && !isImage && content && (
              <div className="p-6 prose dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm">{content}</pre>
              </div>
            )}
          </>
        )}

        {document.status === 'pending' && (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">Document queued for processing...</p>
          </div>
        )}
      </div>
    </div>
  );
}
