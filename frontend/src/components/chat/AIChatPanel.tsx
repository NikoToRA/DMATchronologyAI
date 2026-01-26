'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Send,
  Loader2,
  MessageSquare,
  Plus,
  ChevronLeft,
  Eye,
  Edit3,
} from 'lucide-react';
import { chatApi, ChatThreadSummary, ChatMessage } from '@/lib/api';

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  hqId: string;
  hqName: string;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export function AIChatPanel({
  isOpen,
  onClose,
  sessionId,
  hqId,
  hqName,
}: AIChatPanelProps) {
  // State
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load threads
  const loadThreads = useCallback(async () => {
    if (!sessionId || !hqId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await chatApi.listThreads(sessionId, hqId);
      setThreads(response.data);
    } catch (err: any) {
      console.error('Failed to load threads:', err);
      setError('スレッドの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, hqId]);

  // Load thread messages
  const loadThread = useCallback(
    async (threadId: string) => {
      if (!sessionId || !hqId) return;
      setIsLoading(true);
      setError(null);
      try {
        const response = await chatApi.getThread(sessionId, threadId, hqId);
        const thread = response.data.thread;
        setMessages(
          thread.messages.map((m: ChatMessage) => ({
            id: m.message_id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
          }))
        );
        setCanWrite(response.data.can_write);
        setCurrentThreadId(threadId);
        setView('chat');
      } catch (err: any) {
        console.error('Failed to load thread:', err);
        setError('スレッドの読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, hqId]
  );

  // Create new thread
  const createThread = useCallback(
    async (message: string) => {
      if (!sessionId || !hqId || !hqName || !message.trim()) return;
      setIsSending(true);
      setError(null);
      try {
        const response = await chatApi.createThread(sessionId, {
          hq_id: hqId,
          hq_name: hqName,
          message: message.trim(),
          include_chronology: true,
        });

        const newThreadId = response.data.thread.id;
        const aiMessage = response.data.message;

        // Set messages with user message and AI response
        setMessages([
          {
            id: 'user-' + Date.now(),
            role: 'user',
            content: message.trim(),
            timestamp: new Date().toISOString(),
          },
          {
            id: aiMessage.id,
            role: 'assistant',
            content: aiMessage.content,
            timestamp: aiMessage.timestamp,
          },
        ]);
        setCurrentThreadId(newThreadId);
        setCanWrite(true);
        setView('chat');
        setInputValue('');

        // Refresh thread list
        loadThreads();
      } catch (err: any) {
        console.error('Failed to create thread:', err);
        setError('スレッドの作成に失敗しました');
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, hqId, hqName, loadThreads]
  );

  // Send message to existing thread
  const sendMessage = useCallback(
    async (message: string) => {
      if (!sessionId || !currentThreadId || !hqId || !message.trim() || !canWrite)
        return;
      setIsSending(true);
      setError(null);

      // Add user message immediately
      const userMessage: LocalMessage = {
        id: 'user-' + Date.now(),
        role: 'user',
        content: message.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setInputValue('');

      try {
        const response = await chatApi.sendMessage(sessionId, currentThreadId, {
          hq_id: hqId,
          message: message.trim(),
          include_chronology: true,
        });

        const aiMessage = response.data.message;
        setMessages((prev) => [
          ...prev,
          {
            id: aiMessage.id,
            role: 'assistant',
            content: aiMessage.content,
            timestamp: aiMessage.timestamp,
          },
        ]);
      } catch (err: any) {
        console.error('Failed to send message:', err);
        setError('メッセージの送信に失敗しました');
        // Remove the optimistically added user message
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, currentThreadId, hqId, canWrite]
  );

  // Handle submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputValue.trim() || isSending) return;

      if (currentThreadId) {
        sendMessage(inputValue);
      } else {
        createThread(inputValue);
      }
    },
    [inputValue, isSending, currentThreadId, sendMessage, createThread]
  );

  // Go back to list
  const handleBackToList = useCallback(() => {
    setView('list');
    setCurrentThreadId(null);
    setMessages([]);
    setCanWrite(false);
    loadThreads();
  }, [loadThreads]);

  // Start new conversation
  const handleNewConversation = useCallback(() => {
    setView('chat');
    setCurrentThreadId(null);
    setMessages([]);
    setCanWrite(true);
    setInputValue('');
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load threads when panel opens
  useEffect(() => {
    if (isOpen && sessionId && hqId) {
      loadThreads();
    }
  }, [isOpen, sessionId, hqId, loadThreads]);

  // Focus input when view changes to chat
  useEffect(() => {
    if (view === 'chat' && canWrite) {
      inputRef.current?.focus();
    }
  }, [view, canWrite]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-24 w-96 max-w-full bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
          {view === 'chat' && currentThreadId ? (
            <button
              onClick={handleBackToList}
              className="flex items-center gap-1 text-sm hover:opacity-80"
            >
              <ChevronLeft className="h-4 w-4" />
              戻る
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              <span className="font-medium">AIアシスタント</span>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-blue-700 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading && view === 'list' ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : view === 'list' ? (
            /* Thread List View */
            <div className="flex-1 overflow-y-auto">
              {/* New conversation button */}
              <button
                onClick={handleNewConversation}
                className="w-full flex items-center gap-2 px-4 py-3 text-blue-600 hover:bg-blue-50 border-b"
              >
                <Plus className="h-5 w-5" />
                <span className="font-medium">新規AI相談</span>
              </button>

              {/* Thread list */}
              {threads.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  まだ相談履歴がありません
                </div>
              ) : (
                <div className="divide-y">
                  {threads.map((thread) => (
                    <button
                      key={thread.thread_id}
                      onClick={() => loadThread(thread.thread_id)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        {thread.can_write ? (
                          <Edit3 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Eye className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              {thread.creator_hq_name}
                            </span>
                          </div>
                          <div className="font-medium text-sm truncate mt-1">
                            {thread.title}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {new Date(thread.updated_at).toLocaleString('ja-JP', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {' '}
                            ({thread.message_count}件)
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Chat View */
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && !isSending && (
                  <div className="text-center text-gray-500 text-sm py-8">
                    クロノロジーの内容についてAIに相談できます。
                    <br />
                    質問を入力してください。
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">
                        {message.content}
                      </div>
                      <div
                        className={`text-xs mt-1 ${
                          message.role === 'user'
                            ? 'text-blue-200'
                            : 'text-gray-400'
                        }`}
                      >
                        {new Date(message.timestamp).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-lg px-3 py-2">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              {canWrite ? (
                <form
                  onSubmit={handleSubmit}
                  className="border-t p-3 bg-white"
                >
                  <div className="flex gap-2">
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      placeholder="メッセージを入力..."
                      className="flex-1 resize-none border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      disabled={isSending}
                    />
                    <button
                      type="submit"
                      disabled={!inputValue.trim() || isSending}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="border-t p-3 bg-gray-50 text-center text-sm text-gray-500">
                  このスレッドは閲覧のみです
                </div>
              )}
            </>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-2 bg-red-50 text-red-600 text-sm border-t border-red-100">
            {error}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
