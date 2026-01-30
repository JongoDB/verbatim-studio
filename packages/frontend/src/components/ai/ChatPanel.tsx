import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { ChatHeader } from './ChatHeader';
import { ChatMessages, type ChatMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { TranscriptPicker, type AttachedTranscript } from './TranscriptPicker';

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  attached: AttachedTranscript[];
  setAttached: React.Dispatch<React.SetStateAction<AttachedTranscript[]>>;
}

export function ChatPanel({
  isOpen,
  onClose,
  messages,
  setMessages,
  attached,
  setAttached,
}: ChatPanelProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const handleSend = useCallback(async (message: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      let fullContent = '';

      for await (const token of api.ai.chatMultiStream({
        message,
        transcript_ids: attached.map((t) => t.id),
        history,
        temperature: 0.7,
      })) {
        if (token.error) {
          throw new Error(token.error);
        }
        if (token.token) {
          fullContent += token.token;
          setStreamingContent(fullContent);
        }
        if (token.done) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: fullContent,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setStreamingContent('');
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [messages, attached, setMessages]);

  const handleAttach = useCallback((transcript: AttachedTranscript) => {
    setAttached((prev) => [...prev, transcript]);
  }, [setAttached]);

  const handleDetach = useCallback((id: string) => {
    setAttached((prev) => prev.filter((t) => t.id !== id));
  }, [setAttached]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-40 w-[400px] h-[500px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-200">
      <ChatHeader attached={attached} onDetach={handleDetach} onClose={onClose} />
      <ChatMessages
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />
      <div className="relative">
        {showPicker && (
          <TranscriptPicker
            attached={attached}
            onAttach={handleAttach}
            onDetach={handleDetach}
            onClose={() => setShowPicker(false)}
          />
        )}
        <ChatInput
          onSend={handleSend}
          onAttachClick={() => setShowPicker(!showPicker)}
          disabled={isStreaming}
          attachedCount={attached.length}
        />
      </div>
    </div>
  );
}
