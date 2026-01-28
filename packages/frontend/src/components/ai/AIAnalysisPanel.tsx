import { useState, useCallback, useEffect } from 'react';
import { api, type SummarizationResponse, type AIChatResponse } from '@/lib/api';

interface AIAnalysisPanelProps {
  transcriptId: string;
}

type TabType = 'summary' | 'ask';

export function AIAnalysisPanel({ transcriptId }: AIAnalysisPanelProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null); // null = loading
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ai.status()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  // Summary state
  const [summary, setSummary] = useState<SummarizationResponse | null>(null);

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
    { id: 'ask', label: 'Ask' },
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

      {/* No-model state */}
      {aiAvailable === false && (
        <div className="p-6 text-center">
          <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">No AI model configured</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
            Download a language model in Settings to enable AI-powered analysis.
          </p>
          <a
            href="/settings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
          >
            Go to Settings
          </a>
        </div>
      )}

      {aiAvailable === null && (
        <div className="p-6 text-center">
          <svg className="w-5 h-5 mx-auto animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Checking AI availability...</p>
        </div>
      )}

      {/* Tabs + Content (hidden when AI unavailable) */}
      {aiAvailable && <>
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

                {summary.named_entities && summary.named_entities.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">People</h4>
                    <div className="flex flex-wrap gap-2">
                      {summary.named_entities.map((entity, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        >
                          {entity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSummarize}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline disabled:opacity-50"
                >
                  {isLoading && (
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isLoading ? 'Regenerating...' : 'Regenerate'}
                </button>
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
      </>}
    </div>
  );
}
