import { useState, useEffect, useCallback } from 'react';
import { api, type BrowseItem, type BrowseResponse, type FolderTreeNode, type FileProperties } from '@/lib/api';
import { formatDateTime, formatDate } from '@/lib/utils';
import { Breadcrumb } from '@/components/browser/Breadcrumb';

interface FileBrowserPageProps {
  initialFolderId?: string | null;
  onViewRecording: (recordingId: string) => void;
  onViewDocument: (documentId: string) => void;
}

type SortField = 'name' | 'updated_at' | 'size' | 'type';
type SortOrder = 'asc' | 'desc';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ItemIcon({ type, mimeType, size = 'md' }: { type: string; mimeType?: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-8 h-8';

  if (type === 'folder') {
    return (
      <svg className={`${sizeClass} text-yellow-500`} fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }
  if (type === 'recording') {
    return (
      <svg className={`${sizeClass} text-purple-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    );
  }
  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType?.startsWith('image/');
  if (isPdf) {
    return (
      <svg className={`${sizeClass} text-red-500`} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    );
  }
  if (isImage) {
    return (
      <svg className={`${sizeClass} text-green-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  return (
    <svg className={`${sizeClass} text-blue-500`} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
    </svg>
  );
}

// Move Dialog Component
function MoveDialog({
  items,
  folders,
  currentFolderId,
  onMove,
  onClose,
}: {
  items: BrowseItem[];
  folders: FolderTreeNode[];
  currentFolderId: string | null;
  onMove: (targetId: string | null) => void;
  onClose: () => void;
}) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const title = items.length === 1 ? `Move "${items[0].name}"` : `Move ${items.length} items`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h3>
        </div>
        <div className="p-4 max-h-64 overflow-y-auto">
          {/* Root option */}
          <button
            onClick={() => setSelectedFolder(null)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
              selectedFolder === null
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            } ${currentFolderId === null ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={currentFolderId === null}
          >
            <ItemIcon type="folder" size="sm" />
            <span className="text-sm font-medium">My Files (Root)</span>
          </button>

          {/* Folders */}
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => setSelectedFolder(folder.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                selectedFolder === folder.id
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              } ${currentFolderId === folder.id ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={currentFolderId === folder.id}
            >
              <ItemIcon type="folder" size="sm" />
              <span className="text-sm">{folder.name}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{folder.item_count} items</span>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onMove(selectedFolder)}
            disabled={selectedFolder === currentFolderId}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}

// Properties Dialog Component
function PropertiesDialog({
  item,
  onClose,
}: {
  item: BrowseItem;
  onClose: () => void;
}) {
  const [properties, setProperties] = useState<FileProperties | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProperties = async () => {
      setLoading(true);
      setError(null);
      try {
        if (item.type === 'recording') {
          const props = await api.recordings.getProperties(item.id);
          setProperties(props);
        } else if (item.type === 'document') {
          const props = await api.documents.getProperties(item.id);
          setProperties(props);
        }
      } catch (err) {
        console.error('Failed to load properties:', err);
        setError('Failed to load file properties');
      } finally {
        setLoading(false);
      }
    };
    fetchProperties();
  }, [item.id, item.type]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Properties
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="w-6 h-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : error ? (
            <p className="text-red-500 text-center py-4">{error}</p>
          ) : properties ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 mb-4">
                <ItemIcon type={item.type} mimeType={item.mime_type} />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{properties.title}</p>
                  <p className="text-sm text-gray-500">{item.type === 'recording' ? 'Recording' : 'Document'}</p>
                </div>
              </div>

              <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Location:</span>
                <span className="text-gray-900 dark:text-gray-100 font-mono text-xs break-all">{properties.file_path}</span>

                <span className="text-gray-500 dark:text-gray-400">Size:</span>
                <span className="text-gray-900 dark:text-gray-100">{properties.file_size_formatted}</span>

                <span className="text-gray-500 dark:text-gray-400">File exists:</span>
                <span className={properties.file_exists ? 'text-green-600' : 'text-red-600'}>
                  {properties.file_exists ? 'Yes' : 'No - file missing'}
                </span>

                {properties.duration_formatted && (
                  <>
                    <span className="text-gray-500 dark:text-gray-400">Duration:</span>
                    <span className="text-gray-900 dark:text-gray-100">{properties.duration_formatted}</span>
                  </>
                )}

                {properties.page_count && (
                  <>
                    <span className="text-gray-500 dark:text-gray-400">Pages:</span>
                    <span className="text-gray-900 dark:text-gray-100">{properties.page_count}</span>
                  </>
                )}

                <span className="text-gray-500 dark:text-gray-400">Type:</span>
                <span className="text-gray-900 dark:text-gray-100">{properties.mime_type || 'Unknown'}</span>

                <span className="text-gray-500 dark:text-gray-400">Status:</span>
                <span className="text-gray-900 dark:text-gray-100 capitalize">{properties.status}</span>

                <span className="text-gray-500 dark:text-gray-400">Created:</span>
                <span className="text-gray-900 dark:text-gray-100">{formatDateTime(properties.created_at)}</span>

                <span className="text-gray-500 dark:text-gray-400">Modified:</span>
                <span className="text-gray-900 dark:text-gray-100">{formatDateTime(properties.updated_at)}</span>

                {properties.storage_location && (
                  <>
                    <span className="text-gray-500 dark:text-gray-400">Storage:</span>
                    <span className="text-gray-900 dark:text-gray-100">{properties.storage_location}</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function FileBrowserPage({ initialFolderId, onViewRecording, onViewDocument }: FileBrowserPageProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId ?? null);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Map<string, BrowseItem>>(new Map());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: BrowseItem } | null>(null);
  const [moveItem, setMoveItem] = useState<BrowseItem | null>(null);
  const [moveItems, setMoveItems] = useState<BrowseItem[] | null>(null);
  const [propertiesItem, setPropertiesItem] = useState<BrowseItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFolder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, treeData] = await Promise.all([
        api.browse.list({
          parent_id: currentFolderId ?? undefined,
          search: debouncedSearch || undefined,
          sort: sortField,
          order: sortOrder,
        }),
        api.browse.tree(),
      ]);
      setBrowseData(data);
      setFolders(treeData.root.children);
      setSelectedItems(new Map());
      setLastSelectedId(null);
    } catch (err) {
      console.error('Failed to load folder:', err);
      setError('Failed to load folder');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, debouncedSearch, sortField, sortOrder]);

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: BrowseItem) => {
    e.preventDefault();
    const menuWidth = 160;
    const menuHeight = 200;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    setContextMenu({ x, y, item });
  };

  const handleRename = async (item: BrowseItem) => {
    const newName = prompt('Enter new name:', item.name);
    if (newName && newName !== item.name) {
      try {
        await api.browse.rename(item.id, item.type, newName);
        loadFolder();
      } catch (err) {
        console.error('Failed to rename:', err);
        setError('Failed to rename item');
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
      setError('Failed to delete item');
    }
    setContextMenu(null);
  };

  const handleMove = async (item: BrowseItem, targetFolderId: string | null) => {
    if (item.type === 'folder') return;
    try {
      await api.browse.move(item.id, item.type as 'recording' | 'document', targetFolderId);
      loadFolder();
    } catch (err) {
      console.error('Failed to move:', err);
      setError('Failed to move item');
    }
  };

  const handleCopy = async (item: BrowseItem) => {
    if (item.type === 'folder') return;
    try {
      await api.browse.copy(item.id, item.type as 'recording' | 'document', currentFolderId);
      loadFolder();
    } catch (err) {
      console.error('Failed to copy:', err);
      setError('Failed to copy item');
    }
    setContextMenu(null);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: BrowseItem) => {
    if (item.type === 'folder') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/json', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderId);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverFolder(null);

    try {
      const item: BrowseItem = JSON.parse(e.dataTransfer.getData('application/json'));
      if (item.type !== 'folder') {
        await handleMove(item, targetFolderId);
      }
    } catch (err) {
      console.error('Drop failed:', err);
    }
  };

  const getItemSize = (item: BrowseItem): string => {
    if (item.type === 'folder') return `${item.item_count ?? 0} items`;
    if (item.type === 'recording') return item.duration_seconds ? formatDuration(item.duration_seconds) : '-';
    return item.file_size_bytes ? formatSize(item.file_size_bytes) : '-';
  };

  const getItemType = (item: BrowseItem): string => {
    if (item.type === 'folder') return 'Folder';
    if (item.type === 'recording') return 'Recording';
    if (item.mime_type?.includes('pdf')) return 'PDF';
    if (item.mime_type?.startsWith('image/')) return 'Image';
    return 'Document';
  };

  // Selection handlers
  const toggleItemSelection = (item: BrowseItem, e?: React.MouseEvent) => {
    const newSelected = new Map(selectedItems);
    const itemKey = `${item.type}-${item.id}`;

    if (e?.shiftKey && lastSelectedId && browseData?.items) {
      // Shift+click: select range
      const items = browseData.items;
      const lastIndex = items.findIndex(i => `${i.type}-${i.id}` === lastSelectedId);
      const currentIndex = items.findIndex(i => `${i.type}-${i.id}` === itemKey);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        for (let i = start; i <= end; i++) {
          const key = `${items[i].type}-${items[i].id}`;
          newSelected.set(key, items[i]);
        }
      }
    } else if (e?.metaKey || e?.ctrlKey) {
      // Cmd/Ctrl+click: toggle individual
      if (newSelected.has(itemKey)) {
        newSelected.delete(itemKey);
      } else {
        newSelected.set(itemKey, item);
      }
    } else {
      // Regular click: select only this item
      newSelected.clear();
      newSelected.set(itemKey, item);
    }

    setSelectedItems(newSelected);
    setLastSelectedId(itemKey);
  };

  const toggleCheckbox = (item: BrowseItem, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newSelected = new Map(selectedItems);
    const itemKey = `${item.type}-${item.id}`;

    if (newSelected.has(itemKey)) {
      newSelected.delete(itemKey);
    } else {
      newSelected.set(itemKey, item);
    }

    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    if (!browseData?.items) return;
    const newSelected = new Map<string, BrowseItem>();
    browseData.items.forEach(item => {
      newSelected.set(`${item.type}-${item.id}`, item);
    });
    setSelectedItems(newSelected);
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
    setLastSelectedId(null);
  };

  const isAllSelected = browseData?.items && browseData.items.length > 0 &&
    browseData.items.every(item => selectedItems.has(`${item.type}-${item.id}`));

  const isSomeSelected = selectedItems.size > 0 && !isAllSelected;

  // Bulk actions
  const handleBulkDelete = async () => {
    const items = Array.from(selectedItems.values());
    if (items.length === 0) return;

    const confirmMsg = items.length === 1
      ? `Delete "${items[0].name}"?`
      : `Delete ${items.length} items?`;

    if (!confirm(confirmMsg)) return;

    setBulkDeleting(true);
    try {
      for (const item of items) {
        await api.browse.delete(item.type, item.id);
      }
      loadFolder();
    } catch (err) {
      console.error('Failed to delete items:', err);
      setError('Failed to delete some items');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkMove = async (targetFolderId: string | null) => {
    const items = Array.from(selectedItems.values()).filter(i => i.type !== 'folder');
    if (items.length === 0) return;

    try {
      for (const item of items) {
        await api.browse.move(item.id, item.type as 'recording' | 'document', targetFolderId);
      }
      loadFolder();
    } catch (err) {
      console.error('Failed to move items:', err);
      setError('Failed to move some items');
    }
    setMoveItems(null);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return (
      <svg className="w-4 h-4 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d={sortOrder === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
        />
      </svg>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <Breadcrumb items={browseData?.breadcrumb || []} onNavigate={handleNavigate} />
          <div className="flex-1" />

          {/* Bulk action toolbar */}
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2 mr-4">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selectedItems.size} selected
              </span>
              <button
                onClick={clearSelection}
                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  const items = Array.from(selectedItems.values()).filter(i => i.type !== 'folder');
                  if (items.length > 0) setMoveItems(items);
                }}
                disabled={Array.from(selectedItems.values()).every(i => i.type === 'folder')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Move
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          )}

          <input
            type="text"
            placeholder="Search files..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 w-64"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
          <span className="text-red-700 dark:text-red-300 text-sm">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
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
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeSelected;
                    }}
                    onChange={() => isAllSelected ? clearSelection() : selectAll()}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('name')}
                >
                  Name <SortIcon field="name" />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 w-40"
                  onClick={() => handleSort('updated_at')}
                >
                  Modified <SortIcon field="updated_at" />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 w-32"
                  onClick={() => handleSort('size')}
                >
                  Size <SortIcon field="size" />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 w-28"
                  onClick={() => handleSort('type')}
                >
                  Type <SortIcon field="type" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {browseData?.items.map((item) => {
                const itemKey = `${item.type}-${item.id}`;
                const isSelected = selectedItems.has(itemKey);
                return (
                  <tr
                    key={itemKey}
                    draggable={item.type !== 'folder'}
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragOver={item.type === 'folder' ? (e) => handleDragOver(e, item.id) : undefined}
                    onDragLeave={item.type === 'folder' ? handleDragLeave : undefined}
                    onDrop={item.type === 'folder' ? (e) => handleDrop(e, item.id) : undefined}
                    onClick={(e) => toggleItemSelection(item, e)}
                    onDoubleClick={() => handleOpen(item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : dragOverFolder === item.id
                        ? 'bg-blue-100 dark:bg-blue-900/40'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleCheckbox(item, e)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <ItemIcon type={item.type} mimeType={item.mime_type} />
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {item.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {item.updated_at ? formatDate(item.updated_at) : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {getItemSize(item)}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {getItemType(item)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
              onClick={() => { handleOpen(contextMenu.item); setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Open
            </button>
            <button
              onClick={() => handleRename(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Rename
            </button>
            {contextMenu.item.type !== 'folder' && (
              <>
                <button
                  onClick={() => handleCopy(contextMenu.item)}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Make a copy
                </button>
                <button
                  onClick={() => { setMoveItem(contextMenu.item); setContextMenu(null); }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Move to...
                </button>
              </>
            )}
            {contextMenu.item.type !== 'folder' && (
              <button
                onClick={() => { setPropertiesItem(contextMenu.item); setContextMenu(null); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Properties
              </button>
            )}
            <hr className="my-1 border-gray-200 dark:border-gray-700" />
            <button
              onClick={() => handleDelete(contextMenu.item)}
              className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Move dialog (single item) */}
      {moveItem && (
        <MoveDialog
          items={[moveItem]}
          folders={folders}
          currentFolderId={currentFolderId}
          onMove={(targetId) => {
            handleMove(moveItem, targetId);
            setMoveItem(null);
          }}
          onClose={() => setMoveItem(null)}
        />
      )}

      {/* Move dialog (bulk) */}
      {moveItems && moveItems.length > 0 && (
        <MoveDialog
          items={moveItems}
          folders={folders}
          currentFolderId={currentFolderId}
          onMove={(targetId) => handleBulkMove(targetId)}
          onClose={() => setMoveItems(null)}
        />
      )}

      {/* Properties dialog */}
      {propertiesItem && (
        <PropertiesDialog
          item={propertiesItem}
          onClose={() => setPropertiesItem(null)}
        />
      )}
    </div>
  );
}
