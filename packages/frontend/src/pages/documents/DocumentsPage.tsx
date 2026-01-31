import { useState, useEffect, useCallback } from 'react';
import { api, type Document, type Project } from '@/lib/api';
import { DocumentCard } from '@/components/documents/DocumentCard';
import { UploadDocumentDialog } from '@/components/documents/UploadDocumentDialog';

interface DocumentsPageProps {
  onViewDocument: (documentId: string) => void;
}

export function DocumentsPage({ onViewDocument }: DocumentsPageProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadDocuments = useCallback(async () => {
    try {
      const params: { search?: string; status?: string } = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.documents.list(params);
      setDocuments(response.items);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    loadDocuments();
    api.projects.list().then((r) => setProjects(r.items)).catch(console.error);
  }, [loadDocuments]);

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await api.documents.delete(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Documents</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Upload and manage your documents
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Document grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">No documents</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Upload your first document to get started
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Upload Document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onClick={() => onViewDocument(doc.id)}
              onDelete={() => handleDelete(doc.id)}
            />
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <UploadDocumentDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={loadDocuments}
        projects={projects}
      />
    </div>
  );
}
