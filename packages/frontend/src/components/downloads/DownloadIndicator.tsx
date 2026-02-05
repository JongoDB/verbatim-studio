/**
 * Download indicator for the sidebar.
 * Shows a badge with active download count and progress.
 */
import { useState } from 'react';
import { useActiveDownloads, useTotalDownloadProgress, useDownloadStore } from '@/stores/downloadStore';

interface DownloadIndicatorProps {
  collapsed?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function DownloadIndicator({ collapsed }: DownloadIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const activeDownloads = useActiveDownloads();
  const progress = useTotalDownloadProgress();
  const removeDownload = useDownloadStore((state) => state.removeDownload);

  if (activeDownloads.length === 0) return null;

  return (
    <div className="relative">
      {/* Indicator button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={[
          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30',
          'relative group',
        ].join(' ')}
      >
        {/* Animated download icon */}
        <span className="shrink-0 relative">
          <svg
            className="w-5 h-5 animate-bounce"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          {/* Badge */}
          <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold">
            {activeDownloads.length}
          </span>
        </span>

        {/* Text (hidden when collapsed) */}
        <span
          className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
            collapsed ? 'md:w-0 md:opacity-0' : 'md:w-auto md:opacity-100'
          }`}
        >
          Downloading...
        </span>

        {/* Progress percent */}
        {progress && (
          <span
            className={`ml-auto text-xs font-medium overflow-hidden whitespace-nowrap transition-all duration-300 ${
              collapsed ? 'md:w-0 md:opacity-0' : 'md:w-auto md:opacity-100'
            }`}
          >
            {progress.percent}%
          </span>
        )}

        {/* Tooltip when collapsed */}
        {collapsed && (
          <span className="hidden md:block absolute left-full ml-2 px-2 py-1 rounded-md bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-100 z-50">
            {activeDownloads.length} download{activeDownloads.length > 1 ? 's' : ''} in progress
          </span>
        )}
      </button>

      {/* Expanded dropdown */}
      {expanded && !collapsed && (
        <div className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-lg bg-card border border-border shadow-lg z-50">
          <div className="text-xs font-medium text-muted-foreground mb-2">Active Downloads</div>
          <div className="space-y-2">
            {activeDownloads.map((download) => (
              <div key={download.modelId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground truncate">{download.modelName}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDownload(download.modelId);
                    }}
                    className="text-muted-foreground hover:text-foreground p-1"
                    title="Cancel download"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{
                      width: download.totalBytes > 0
                        ? `${(download.downloadedBytes / download.totalBytes) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{download.message || 'Downloading...'}</span>
                  <span>
                    {formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
