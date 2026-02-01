import type { HighlightColor } from '@/lib/api';

const COLORS: { value: HighlightColor; bg: string; label: string }[] = [
  { value: 'yellow', bg: 'bg-yellow-300', label: 'Yellow' },
  { value: 'green', bg: 'bg-green-300', label: 'Green' },
  { value: 'blue', bg: 'bg-blue-300', label: 'Blue' },
  { value: 'red', bg: 'bg-red-300', label: 'Red' },
  { value: 'purple', bg: 'bg-purple-300', label: 'Purple' },
  { value: 'orange', bg: 'bg-orange-300', label: 'Orange' },
];

interface BulkHighlightToolbarProps {
  selectedCount: number;
  onHighlight: (color: HighlightColor) => void;
  onRemoveHighlight: () => void;
  onClearSelection: () => void;
}

export function BulkHighlightToolbar({
  selectedCount,
  onHighlight,
  onRemoveHighlight,
  onClearSelection,
}: BulkHighlightToolbarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/80 shadow-xl backdrop-blur-sm">
      <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
        {selectedCount} selected
      </span>

      <div className="w-px h-5 bg-purple-300 dark:bg-purple-600" />

      <div className="flex items-center gap-2">
        {COLORS.map(({ value, bg, label }) => (
          <button
            key={value}
            onClick={() => onHighlight(value)}
            className={`w-11 h-11 rounded-full ${bg} transition-transform hover:scale-110 shadow-sm`}
            title={`Highlight ${label}`}
          />
        ))}
      </div>

      <div className="w-px h-5 bg-purple-300 dark:bg-purple-600" />

      <button
        onClick={onRemoveHighlight}
        className="text-xs font-medium text-purple-700 dark:text-purple-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
      >
        Remove
      </button>

      <button
        onClick={onClearSelection}
        className="text-xs font-medium text-purple-700 dark:text-purple-300 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
      >
        Clear
      </button>
    </div>
  );
}
