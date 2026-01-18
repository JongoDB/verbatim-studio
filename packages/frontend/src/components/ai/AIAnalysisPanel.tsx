import { useState, useCallback } from 'react';
import { api, type SummarizationResponse, type AnalysisResponse, type AnalysisType, type AIChatResponse } from '@/lib/api';

interface AIAnalysisPanelProps {
  transcriptId: string;
}

type TabType = 'summary' | 'analysis' | 'ask';

export function AIAnalysisPanel({ transcriptId }: AIAnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Summary state
  const [summary, setSummary] = useState<SummarizationResponse | null>(null);

  // Analysis state
  const [analysisType, setAnalysisType] = useState<AnalysisType>('topics');
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);

  // Ask state
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AIChatResponse | null>(null);

  const handleSummarize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.ai.summarize(transcriptId);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsLoading(false);
    }
  }, [transcriptId]);

  const handleAnalyze = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.ai.analyze(transcriptId, analysisType);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze transcript');
    } finally {
      setIsLoading(false);
    }
  }, [transcriptId, analysisType]);

  const handleAsk = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await api.ai.ask(transcriptId, question);
      setAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get answer');
    } finally {
      setIsLoading(false);
    }
  }, [transcriptId, question]);

  const tabs: Array<{ id: TabType; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'ask', label: 'Ask' },
  ];

  const analysisTypes: Array<{ value: AnalysisType; label: string }> = [
    { value: 'topics', label: 'Topics' },
    { value: 'sentiment', label: 'Sentiment' },
    { value: 'entities', label: 'Entities' },
    { value: 'questions', label: 'Questions' },
    { value: 'action_items', label: 'Action Items' },
  ];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-600 dark:text-purple-400"
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
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            AI Analysis
          </h3>
          <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
            Beta
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-purple-600 dark:text-purple-400 border-b-2 border-purple-600 dark:border-purple-400 -mb-px'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-4">
            {!summary ? (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Generate an AI-powered summary of this transcript including key points, action items, and topics.
                </p>
                <button
                  onClick={handleSummarize}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {isLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating...
                    </>
                  ) : (
                    'Generate Summary'
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Summary</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{summary.summary}</p>
                </div>

                {summary.key_points && summary.key_points.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Key Points</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {summary.key_points.map((point, i) => (
                        <li key={i} className="text-sm text-gray-600 dark:text-gray-300">{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.action_items && summary.action_items.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Action Items</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {summary.action_items.map((item, i) => (
                        <li key={i} className="text-sm text-gray-600 dark:text-gray-300">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.topics && summary.topics.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Topics</h4>
                    <div className="flex flex-wrap gap-2">
                      {summary.topics.map((topic, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSummarize}
                  disabled={isLoading}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Regenerate
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <select
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value as AnalysisType)}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                {analysisTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAnalyze}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isLoading ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>

            {analysis && (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2 capitalize">
                  {analysis.analysis_type} Analysis
                </h4>
                <pre className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {typeof analysis.content.raw_analysis === 'string'
                    ? analysis.content.raw_analysis
                    : JSON.stringify(analysis.content, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ask' && (
          <div className="space-y-4">
            <form onSubmit={handleAsk} className="space-y-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about this transcript..."
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
              />
              <button
                type="submit"
                disabled={isLoading || !question.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isLoading ? 'Thinking...' : 'Ask'}
              </button>
            </form>

            {answer && (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    className="w-4 h-4 text-purple-600 dark:text-purple-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {answer.model}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {answer.content}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
