import { useState, useEffect, useCallback } from 'react';
import { api, type BrowseItem, type BrowseResponse } from '@/lib/api';
import { FolderTree } from '@/components/browser/FolderTree';
import { Breadcrumb } from '@/components/browser/Breadcrumb';
import { BrowserItem } from '@/components/browser/BrowserItem';

interface FileBrowserPageProps {
  initialFolderId?: string | null;
  onViewRecording: (recordingId: string) => void;
  onViewDocument: (documentId: string) => void;
}

export function FileBrowserPage({ initialFolderId, onViewRecording, onViewDocument }: FileBrowserPageProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId ?? null);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: BrowseItem } | null>(null);

  const loadFolder = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.browse.list({
        parent_id: currentFolderId ?? undefined,
        search: search || undefined,
      });
      setBrowseData(data);
      setSelectedItems(new Set());
    } catch (err) {
      console.error('Failed to load folder:', err);
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, search]);

  useEffect(() => {
    loadFolder();
  }, [loadFolder]);

  const handleNavigate = (folderId: string | null) => {
    setCurrentFolderId(folderId);
  };

  const handleOpen = (item: BrowseItem) => {
    if (item.type === 'folder') {
      setCurrentFolderId(item.id);
    } else if (item.type === 'recording') {
      onViewRecording(item.id);
    } else if (item.type === 'document') {
      onViewDocument(item.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: BrowseItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleRename = async (item: BrowseItem) => {
    const newName = prompt('Enter new name:', item.name);
    if (newName && newName !== item.name) {
      try {
        await api.browse.rename(item.id, item.type, newName);
        loadFolder();
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
    setContextMenu(null);
  };

  const handleDelete = async (item: BrowseItem) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.browse.delete(item.type, item.id);
      loadFolder();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
    setContextMenu(null);
  };

  const handleMove = async (item: BrowseItem) => {
    if (item.type === 'folder') return;
    const targetId = prompt('Enter target folder ID (empty for root):');
    if (targetId !== null) {
      try {
        await api.browse.move(item.id, item.type as 'recording' | 'document', targetId || null);
        loadFolder();
      } catch (err) {
        console.error('Failed to move:', err);
      }
    }
    setContextMenu(null);
  };

  const handleCopy = async (item: BrowseItem) => {
    if (item.type === 'folder') return;
    try {
      await api.browse.copy(item.id, item.type as 'recording' | 'document', currentFolderId);
      loadFolder();
    } catch (err) {
      console.error('Failed to copy:', err);
    }
    setContextMenu(null);
  };

  return (
    <div className="flex h-full">
      {/* Sidebar with folder tree */}
      <div className="w-56 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Folders</h3>
        </div>
        <FolderTree selectedFolderId={currentFolderId} onSelectFolder={handleNavigate} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4">
          <Breadcrumb items={browseData?.breadcrumb || []} onNavigate={handleNavigate} />
          <div className="flex-1" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
          />
          <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : browseData?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p>This folder is empty</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-1'}>
              {browseData?.items.map((item) => (
                <BrowserItem
                  key={`${item.type}-${item.id}`}
                  item={item}
                  viewMode={viewMode}
                  selected={selectedItems.has(item.id)}
                  onSelect={() => setSelectedItems(new Set([item.id]))}
                  onOpen={() => handleOpen(item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handleOpen(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Open
            </button>
            <button
              onClick={() => handleRename(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Rename
            </button>
            {contextMenu.item.type !== 'folder' && (
              <>
                <button
                  onClick={() => handleCopy(contextMenu.item)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Copy here
                </button>
                <button
                  onClick={() => handleMove(contextMenu.item)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Move to...
                </button>
              </>
            )}
            <hr className="my-1 border-gray-200 dark:border-gray-700" />
            <button
              onClick={() => handleDelete(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
