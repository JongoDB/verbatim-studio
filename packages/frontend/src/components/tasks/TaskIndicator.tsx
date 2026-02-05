/**
 * Task indicator for the sidebar.
 * Shows a badge with active task count and progress (e.g., AI summarization).
 */
import { useState } from 'react';
import { useActiveTasks, useTotalTaskProgress, useTaskStore, type TaskType } from '@/stores/taskStore';

interface TaskIndicatorProps {
  collapsed?: boolean;
}

function getTaskIcon(taskType: TaskType): React.ReactNode {
  switch (taskType) {
    case 'summarize':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case 'transcribe':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      );
    case 'embed':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
      );
    case 'process_document':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
  }
}

function getTaskLabel(taskType: TaskType): string {
  switch (taskType) {
    case 'summarize':
      return 'Generating Summary';
    case 'transcribe':
      return 'Transcribing';
    case 'embed':
      return 'Generating Embeddings';
    case 'process_document':
      return 'Processing Document';
    default:
      return 'Processing';
  }
}

export function TaskIndicator({ collapsed }: TaskIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const activeTasks = useActiveTasks();
  const progress = useTotalTaskProgress();
  const removeTask = useTaskStore((state) => state.removeTask);

  if (activeTasks.length === 0) return null;

  return (
    <div className="relative">
      {/* Indicator button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={[
          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30',
          'relative group',
        ].join(' ')}
      >
        {/* Animated sparkle icon */}
        <span className="shrink-0 relative">
          <svg
            className="w-5 h-5 animate-pulse"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          {/* Badge */}
          <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-purple-600 text-white text-[10px] font-bold">
            {activeTasks.length}
          </span>
        </span>

        {/* Text (hidden when collapsed) */}
        <span
          className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
            collapsed ? 'md:w-0 md:opacity-0' : 'md:w-auto md:opacity-100'
          }`}
        >
          AI Processing...
        </span>

        {/* Progress percent */}
        {progress && (
          <span
            className={`ml-auto text-xs font-medium overflow-hidden whitespace-nowrap transition-all duration-300 ${
              collapsed ? 'md:w-0 md:opacity-0' : 'md:w-auto md:opacity-100'
            }`}
          >
            {progress.averageProgress}%
          </span>
        )}

        {/* Tooltip when collapsed */}
        {collapsed && (
          <span className="hidden md:block absolute left-full ml-2 px-2 py-1 rounded-md bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-100 z-50">
            {activeTasks.length} task{activeTasks.length > 1 ? 's' : ''} in progress
          </span>
        )}
      </button>

      {/* Expanded dropdown */}
      {expanded && !collapsed && (
        <div className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-lg bg-card border border-border shadow-lg z-50">
          <div className="text-xs font-medium text-muted-foreground mb-2">Active Tasks</div>
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div key={task.jobId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-500">{getTaskIcon(task.taskType)}</span>
                    <span className="font-medium text-foreground truncate">{task.taskName}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.jobId);
                    }}
                    className="text-muted-foreground hover:text-foreground p-1"
                    title="Dismiss"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all duration-300"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{task.message || getTaskLabel(task.taskType)}</span>
                  <span>{Math.round(task.progress)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
