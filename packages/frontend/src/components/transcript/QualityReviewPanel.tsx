import { useState } from 'react';
import { api, type QualityReviewRecord, type ApplyResponse } from '@/lib/api';

interface QualityReviewPanelProps {
  record: QualityReviewRecord;
  transcriptId: string;
  onApplied: () => void;
  onDismiss: () => void;
}

export function QualityReviewPanel({ record, transcriptId, onApplied, onDismiss }: QualityReviewPanelProps) {
  const [acceptedCorrections, setAcceptedCorrections] = useState<Set<string>>(new Set());
  const [acceptedRemovals, setAcceptedRemovals] = useState<Set<string>>(new Set());
  const [acceptedMerges, setAcceptedMerges] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [expandedSection, setExpandedSection] = useState<'corrections' | 'removals' | 'merges' | null>('corrections');

  const corrections = record.corrections_json;
  const stats = record.stats_json;

  const isAlreadyApplied = record.status === 'applied' || record.status === 'partially_applied';

  const totalSelected = acceptedCorrections.size + acceptedRemovals.size + acceptedMerges.size;

  const toggleCorrection = (id: string) => {
    setAcceptedCorrections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRemoval = (id: string) => {
    setAcceptedRemovals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMerge = (idx: number) => {
    setAcceptedMerges(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    if (!corrections) return;
    setAcceptedCorrections(new Set(corrections.corrected_segments.map(c => c.segment_id)));
    setAcceptedRemovals(new Set(corrections.removed_segment_ids));
    setAcceptedMerges(new Set(corrections.merge_suggestions.map((_, i) => i)));
  };

  const deselectAll = () => {
    setAcceptedCorrections(new Set());
    setAcceptedRemovals(new Set());
    setAcceptedMerges(new Set());
  };

  const handleApplySelected = async () => {
    if (!record.job_id) return;
    setIsApplying(true);
    try {
      const res = await api.qualityReview.applySelections(transcriptId, record.job_id, {
        accepted_correction_ids: Array.from(acceptedCorrections),
        accepted_removal_ids: Array.from(acceptedRemovals),
        accepted_merge_indexes: Array.from(acceptedMerges),
      });
      setResult(res);
      onApplied();
    } catch (err) {
      console.error('Failed to apply corrections:', err);
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyAll = async () => {
    if (!record.job_id) return;
    setIsApplying(true);
    try {
      const res = await api.qualityReview.applyAll(transcriptId, record.job_id);
      setResult(res);
      onApplied();
    } catch (err) {
      console.error('Failed to apply all corrections:', err);
    } finally {
      setIsApplying(false);
    }
  };

  if (!corrections || !stats) {
    return null;
  }

  const hasCorrections = corrections.corrected_segments.length > 0;
  const hasRemovals = corrections.removed_segment_ids.length > 0;
  const hasMerges = corrections.merge_suggestions.length > 0;
  const hasAny = hasCorrections || hasRemovals || hasMerges;

  if (result) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">
              Corrections Applied
            </h3>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {result.applied_corrections} text corrections, {result.applied_removals} removals, {result.applied_merges} merges
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="text-sm text-green-700 dark:text-green-300 hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-100 dark:border-purple-800/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-100 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Quality Review
            </h3>
            <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
              Found {stats.corrections} correction{stats.corrections !== 1 ? 's' : ''}, {stats.removals} removal{stats.removals !== 1 ? 's' : ''}, {stats.merges} merge{stats.merges !== 1 ? 's' : ''}
              {stats.blank_removals > 0 && ` (+ ${stats.blank_removals} blank segments)`}
            </p>
          </div>
          <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {!hasAny && (
        <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No corrections found. The transcript looks good!
        </div>
      )}

      {hasAny && (
        <div className="max-h-96 overflow-y-auto">
          {/* Corrections Section */}
          {hasCorrections && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'corrections' ? null : 'corrections')}
                className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700"
              >
                <span>Text Corrections ({corrections.corrected_segments.length})</span>
                <svg className={`w-4 h-4 transition-transform ${expandedSection === 'corrections' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSection === 'corrections' && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {corrections.corrected_segments.map((corr) => (
                    <label
                      key={corr.segment_id}
                      className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                        isAlreadyApplied ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={acceptedCorrections.has(corr.segment_id)}
                        onChange={() => toggleCorrection(corr.segment_id)}
                        className="mt-1 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        disabled={isAlreadyApplied}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                            {corr.correction_type}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {Math.round(corr.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-xs text-red-600 dark:text-red-400 line-through">{corr.original_text}</p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">{corr.corrected_text}</p>
                        {corr.explanation && (
                          <p className="text-[10px] text-gray-500 mt-0.5 italic">{corr.explanation}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Removals Section */}
          {hasRemovals && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'removals' ? null : 'removals')}
                className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700"
              >
                <span>Removals ({corrections.removed_segment_ids.length})</span>
                <svg className={`w-4 h-4 transition-transform ${expandedSection === 'removals' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSection === 'removals' && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {corrections.removed_segment_ids.map((segId) => (
                    <label
                      key={segId}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                        isAlreadyApplied ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={acceptedRemovals.has(segId)}
                        onChange={() => toggleRemoval(segId)}
                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        disabled={isAlreadyApplied}
                      />
                      <span className="text-xs text-red-600 dark:text-red-400 line-through">
                        Segment {segId.slice(0, 8)}...
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Merges Section */}
          {hasMerges && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'merges' ? null : 'merges')}
                className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700"
              >
                <span>Merge Suggestions ({corrections.merge_suggestions.length})</span>
                <svg className={`w-4 h-4 transition-transform ${expandedSection === 'merges' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSection === 'merges' && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {corrections.merge_suggestions.map((merge, idx) => (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                        isAlreadyApplied ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={acceptedMerges.has(idx)}
                        onChange={() => toggleMerge(idx)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        disabled={isAlreadyApplied}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-[10px] text-gray-400">
                            Merge {merge.segment_ids.length} segments
                          </span>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400">{merge.merged_text}</p>
                        {merge.explanation && (
                          <p className="text-[10px] text-gray-500 mt-0.5 italic">{merge.explanation}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {hasAny && !isAlreadyApplied && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Select All
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              onClick={deselectAll}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
            >
              Deselect All
            </button>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
              {totalSelected} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyAll}
              disabled={isApplying}
              className="px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-md transition-colors disabled:opacity-50"
            >
              Accept All
            </button>
            <button
              onClick={handleApplySelected}
              disabled={isApplying || totalSelected === 0}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApplying ? 'Applying...' : `Apply Selected (${totalSelected})`}
            </button>
          </div>
        </div>
      )}

      {isAlreadyApplied && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Corrections have been {record.status === 'applied' ? 'fully' : 'partially'} applied
          </span>
          <button
            onClick={onDismiss}
            className="text-xs text-gray-500 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
