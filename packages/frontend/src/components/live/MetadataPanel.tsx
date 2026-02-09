import { useState, useEffect } from 'react';
import { ProjectSelector } from '@/components/projects/ProjectSelector';
import { TagInput } from '@/components/shared/TagInput';
import { api } from '@/lib/api';

export interface LiveMetadata {
  title: string;
  projectId: string | null;
  tags: string[];
  description: string;
  saveAudio: boolean;
}

interface MetadataPanelProps {
  metadata: LiveMetadata;
  onChange: (metadata: LiveMetadata) => void;
  disabled?: boolean;
}

export function MetadataPanel({ metadata, onChange, disabled = false }: MetadataPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);

  // Load tag suggestions once
  useEffect(() => {
    api.tags.list().then(res => {
      setTagSuggestions(res.items.map(t => t.name));
    }).catch(() => {});
  }, []);

  const update = (patch: Partial<LiveMetadata>) => {
    onChange({ ...metadata, ...patch });
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Recording Setup
          </span>
          {metadata.title && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
              — {metadata.title}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title
            </label>
            <input
              type="text"
              value={metadata.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Recording title..."
              disabled={disabled}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Project
            </label>
            <ProjectSelector
              selectedProjectId={metadata.projectId}
              onProjectChange={(projectId) => update({ projectId })}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tags
            </label>
            <TagInput
              tags={metadata.tags}
              onChange={(tags) => update({ tags })}
              suggestions={tagSuggestions}
              placeholder="Add tags..."
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={metadata.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Optional description..."
              disabled={disabled}
              rows={2}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 resize-none"
            />
          </div>

          {/* Save Audio toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={metadata.saveAudio}
                onChange={(e) => update({ saveAudio: e.target.checked })}
                disabled={disabled}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">
                Save audio recording
              </span>
            </label>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-6">
              {metadata.saveAudio
                ? 'Audio will be saved alongside the transcript for playback'
                : 'Only the text transcript will be saved (no audio file)'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
