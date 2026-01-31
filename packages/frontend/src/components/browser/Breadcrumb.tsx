import { type BrowseItem } from '@/lib/api';

interface BreadcrumbProps {
  items: BrowseItem[];
  onNavigate: (folderId: string | null) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((item, index) => (
        <div key={item.id || 'root'} className="flex items-center">
          {index > 0 && (
            <svg className="w-4 h-4 text-gray-400 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          <button
            onClick={() => onNavigate(item.id || null)}
            className={`px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
              index === items.length - 1
                ? 'font-medium text-gray-900 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {item.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
