/**
 * Global store for tracking background tasks (like AI summarization) across the app.
 * Uses Zustand for lightweight state management.
 */
import { create } from 'zustand';

export type TaskType = 'summarize' | 'transcribe' | 'embed' | 'process_document';

export interface TaskProgress {
  taskId: string;
  jobId: string;
  taskType: TaskType;
  taskName: string;
  status: 'running' | 'complete' | 'error';
  progress: number; // 0-100
  message?: string;
  error?: string;
  recordingId?: string;
  transcriptId?: string;
}

interface TaskState {
  // Active tasks
  tasks: Map<string, TaskProgress>;

  // Actions
  startTask: (jobId: string, taskType: TaskType, taskName: string, extra?: Partial<TaskProgress>) => void;
  updateProgress: (jobId: string, progress: number, message?: string) => void;
  completeTask: (jobId: string) => void;
  failTask: (jobId: string, error: string) => void;
  removeTask: (jobId: string) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: new Map(),

  startTask: (jobId, taskType, taskName, extra) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(jobId, {
        taskId: jobId,
        jobId,
        taskType,
        taskName,
        status: 'running',
        progress: 0,
        ...extra,
      });
      return { tasks: newTasks };
    });
  },

  updateProgress: (jobId, progress, message) => {
    set((state) => {
      const task = state.tasks.get(jobId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(jobId, {
        ...task,
        progress,
        message,
      });
      return { tasks: newTasks };
    });
  },

  completeTask: (jobId) => {
    set((state) => {
      const task = state.tasks.get(jobId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(jobId, {
        ...task,
        status: 'complete',
        progress: 100,
      });
      return { tasks: newTasks };
    });

    // Auto-remove completed tasks after 3 seconds
    setTimeout(() => {
      get().removeTask(jobId);
    }, 3000);
  },

  failTask: (jobId, error) => {
    set((state) => {
      const task = state.tasks.get(jobId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(jobId, {
        ...task,
        status: 'error',
        error,
      });
      return { tasks: newTasks };
    });
  },

  removeTask: (jobId) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(jobId);
      return { tasks: newTasks };
    });
  },
}));

// Derived selectors
export const useActiveTasks = () => {
  const tasks = useTaskStore((state) => state.tasks);
  return Array.from(tasks.values()).filter((t) => t.status === 'running');
};

export const useHasActiveTasks = () => {
  const tasks = useTaskStore((state) => state.tasks);
  return Array.from(tasks.values()).some((t) => t.status === 'running');
};

export const useSummarizeTaskForTranscript = (transcriptId: string) => {
  const tasks = useTaskStore((state) => state.tasks);
  return Array.from(tasks.values()).find(
    (t) => t.taskType === 'summarize' && t.transcriptId === transcriptId && t.status === 'running'
  ) ?? null;
};

export const useTotalTaskProgress = () => {
  const tasks = useTaskStore((state) => state.tasks);
  const active = Array.from(tasks.values()).filter((t) => t.status === 'running');

  if (active.length === 0) return null;

  const totalProgress = active.reduce((sum, t) => sum + t.progress, 0);

  return {
    count: active.length,
    averageProgress: Math.round(totalProgress / active.length),
  };
};
