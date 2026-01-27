import { useEffect, useRef } from 'react';
import type { HighlightColor } from '@/lib/api';

const HIGHLIGHT_COLORS: { value: HighlightColor; bg: string; ring: string; label: string }[] = [
  { value: 'yellow', bg: 'bg-yellow-300', ring: 'ring-yellow-500', label: 'Yellow' },
  { value: 'green', bg: 'bg-green-300', ring: 'ring-green-500', label: 'Green' },
  { value: 'blue', bg: 'bg-blue-300', ring: 'ring-blue-500', label: 'Blue' },
  { value: 'red', bg: 'bg-red-300', ring: 'ring-red-500', label: 'Red' },
  { value: 'purple', bg: 'bg-purple-300', ring: 'ring-purple-500', label: 'Purple' },
  { value: 'orange', bg: 'bg-orange-300', ring: 'ring-orange-500', label: 'Orange' },
];

interface HighlightPickerProps {
  currentColor: HighlightColor | null;
  onSelect: (color: HighlightColor) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function HighlightPicker({ currentColor, onSelect, onRemove, onClose }: HighlightPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-20 top-full mt-1 right-0 flex items-center gap-1.5 p-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg"
    >
      {HIGHLIGHT_COLORS.map(({ value, bg, ring, label }) => (
        <button
          key={value}
          onClick={() => {
            if (value === currentColor) {
              onRemove();
            } else {
              onSelect(value);
            }
            onClose();
          }}
          className={`w-5 h-5 rounded-full ${bg} transition-transform hover:scale-125 ${
            value === currentColor ? `ring-2 ${ring} ring-offset-1 dark:ring-offset-gray-800` : ''
          }`}
          title={value === currentColor ? `Remove ${label}` : label}
        />
      ))}
      {currentColor && (
        <>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />
          <button
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="Remove highlight"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

export { HIGHLIGHT_COLORS };
