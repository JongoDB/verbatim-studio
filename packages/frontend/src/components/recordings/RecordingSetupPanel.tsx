import { useState, useEffect, useCallback, useRef } from 'react';
import { QUALITY_PRESETS, type QualityPreset } from '@/lib/api';

const STORAGE_KEY = 'verbatim-recording-quality';

export interface RecordingMetadata {
  title: string;
  description: string;
  tags: string[];
  participants: string[];
  location: string;
  recordedDate: string;
}

export interface RecordingSettings {
  quality: QualityPreset;
  audioBitsPerSecond: number;
  metadata: RecordingMetadata;
  autoTranscribe: boolean;
}

interface RecordingSetupPanelProps {
  onStartRecording: (settings: RecordingSettings) => void;
  onCancel: () => void;
}

function generateDefaultTitle(): string {
  const now = new Date();
  return `Recording - ${now.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })} ${now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadQuality(): QualityPreset {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in QUALITY_PRESETS) return stored as QualityPreset;
  return 'medium';
}

export function RecordingSetupPanel({ onStartRecording, onCancel }: RecordingSetupPanelProps) {
  const [quality, setQuality] = useState<QualityPreset>(loadQuality);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [autoTranscribe, setAutoTranscribe] = useState(true);

  // Metadata fields
  const [title, setTitle] = useState(generateDefaultTitle);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');
  const [location, setLocation] = useState('');
  const [recordedDate, setRecordedDate] = useState(todayISO);

  const tagInputRef = useRef<HTMLInputElement>(null);
  const participantInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, quality);
  }, [quality]);

  const handleAddChip = useCallback(
    (
      value: string,
      list: string[],
      setList: React.Dispatch<React.SetStateAction<string[]>>,
      setInput: React.Dispatch<React.SetStateAction<string>>,
    ) => {
      const trimmed = value.trim();
      if (trimmed && !list.includes(trimmed)) {
        setList((prev) => [...prev, trimmed]);
      }
      setInput('');
    },
    [],
  );

  const handleChipKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      inputValue: string,
      list: string[],
      setList: React.Dispatch<React.SetStateAction<string[]>>,
      setInput: React.Dispatch<React.SetStateAction<string>>,
    ) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        handleAddChip(inputValue, list, setList, setInput);
      } else if (e.key === 'Backspace' && !inputValue && list.length > 0) {
        setList((prev) => prev.slice(0, -1));
      }
    },
    [handleAddChip],
  );

  const removeChip = useCallback(
    (
      index: number,
      setList: React.Dispatch<React.SetStateAction<string[]>>,
    ) => {
      setList((prev) => prev.filter((_, i) => i !== index));
    },
    [],
  );

  const handleStart = () => {
    const preset = QUALITY_PRESETS[quality];
    onStartRecording({
      quality,
      audioBitsPerSecond: preset.bitrate,
      metadata: {
        title: title.trim() || generateDefaultTitle(),
        description: description.trim(),
        tags,
        participants,
        location: location.trim(),
        recordedDate,
      },
      autoTranscribe,
    });
  };

  const presetKeys = Object.keys(QUALITY_PRESETS) as QualityPreset[];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Recording Setup
      </h3>

      {/* Quality Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Recording Quality
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {presetKeys.map((key) => {
            const preset = QUALITY_PRESETS[key];
            const selected = quality === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setQuality(key)}
                className={`rounded-lg border-2 p-2.5 text-left transition-colors ${
                  selected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className={`text-sm font-semibold ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
                  {preset.label}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {preset.bitrate / 1000} kbps
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {preset.tagline}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  ~{preset.sizeMbPerMin} MB/min
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Details */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Recording Details (Optional)
        </button>

        {detailsOpen && (
          <div className="mt-3 space-y-3">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                placeholder="What is this recording about?"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Tags
              </label>
              <div
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 min-h-[34px] cursor-text"
                onClick={() => tagInputRef.current?.focus()}
              >
                {tags.map((tag, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-300"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeChip(i, setTags); }}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-100"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => handleChipKeyDown(e, tagInput, tags, setTags, setTagInput)}
                  onBlur={() => { if (tagInput.trim()) handleAddChip(tagInput, tags, setTags, setTagInput); }}
                  className="flex-1 min-w-[80px] bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none"
                  placeholder={tags.length === 0 ? 'Type and press Enter...' : ''}
                />
              </div>
            </div>

            {/* Participants */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Participants
              </label>
              <div
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 min-h-[34px] cursor-text"
                onClick={() => participantInputRef.current?.focus()}
              >
                {participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeChip(i, setParticipants); }}
                      className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-100"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  ref={participantInputRef}
                  type="text"
                  value={participantInput}
                  onChange={(e) => setParticipantInput(e.target.value)}
                  onKeyDown={(e) => handleChipKeyDown(e, participantInput, participants, setParticipants, setParticipantInput)}
                  onBlur={() => { if (participantInput.trim()) handleAddChip(participantInput, participants, setParticipants, setParticipantInput); }}
                  className="flex-1 min-w-[80px] bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none"
                  placeholder={participants.length === 0 ? 'Type and press Enter...' : ''}
                />
              </div>
            </div>

            {/* Location */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Location / Context
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Where or why is this being recorded?"
              />
            </div>

            {/* Recorded Date */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Recorded Date
              </label>
              <input
                type="date"
                value={recordedDate}
                onChange={(e) => setRecordedDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Auto-transcribe checkbox */}
      <div className="mb-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoTranscribe}
            onChange={(e) => setAutoTranscribe(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Transcribe after recording</span>
            <p className="text-xs text-gray-500 dark:text-gray-400">Automatically start transcription when recording finishes</p>
          </div>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleStart}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="8" />
          </svg>
          Start Recording
        </button>
      </div>
    </div>
  );
}
