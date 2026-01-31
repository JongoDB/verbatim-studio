import { useState, useEffect } from 'react';
import { api, type FolderTreeNode } from '@/lib/api';

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

function TreeNode({
  node,
  level,
  selectedId,
  onSelect,
}: {
  node: FolderTreeNode;
  level: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const isSelected = node.id === '' ? selectedId === null : selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(node.id || null)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
          isSelected
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="flex-1 text-left truncate">{node.name}</span>
        <span className="text-xs text-gray-400">{node.item_count}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({ selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.browse.tree()
      .then((res) => setTree(res.root))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">Loading...</div>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 text-sm text-gray-500">Failed to load folders</div>
    );
  }

  return (
    <div className="py-2">
      <TreeNode
        node={tree}
        level={0}
        selectedId={selectedFolderId}
        onSelect={onSelectFolder}
      />
    </div>
  );
}
