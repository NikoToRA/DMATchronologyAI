'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowLeft,
  Building2,
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { sessionsApi, chronologyApi, api, Session, ChronologyEntry } from '@/lib/api';
import { useUserSession } from '@/contexts/UserSessionContext';
import { createSessionWebSocket } from '@/lib/websocket';
import {
  addToQueue,
  uploadSegment,
  getPendingSegments,
  getPendingCount,
  startQueueProcessor,
  stopQueueProcessor,
  PendingSegment,
} from '@/lib/audioQueue';

// =============================================================================
// Types
// =============================================================================

type RecordingState = 'idle' | 'recording' | 'processing';

interface UploadHistoryItem {
  id: string;
  timestamp: string;
  status: 'success' | 'failed' | 'pending' | 'uploading';
  duration: number;
  errorMessage?: string;
  retryCount: number;
}

// =============================================================================
// Category Styles
// =============================================================================

const CATEGORY_STYLES: Record<string, string> = {
  '指示': 'bg-red-100 text-red-800',
  '依頼': 'bg-yellow-100 text-yellow-800',
  '報告': 'bg-blue-100 text-blue-800',
  '決定': 'bg-green-100 text-green-800',
  '確認': 'bg-purple-100 text-purple-800',
  'リスク': 'bg-orange-100 text-orange-800',
  'その他': 'bg-gray-100 text-gray-800',
};

// =============================================================================
// Main Component
// =============================================================================

export default function UserSessionPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionId = params.id as string;
  const { session: userSession, isLoggedIn } = useUserSession();

  // State
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pendingCount, setPendingCount] = useState(0);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/user');
    }
  }, [isLoggedIn, router]);

  // Online/Offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Start queue processor and update pending count
  useEffect(() => {
    startQueueProcessor(10000);

    const updatePendingCount = async () => {
      const count = await getPendingCount(sessionId);
      setPendingCount(count);
    };

    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5000);

    return () => {
      stopQueueProcessor();
      clearInterval(interval);
    };
  }, [sessionId]);

  // Fetch session data
  const { data: sessionData, isLoading: isLoadingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId).then((res) => res.data),
    enabled: !!sessionId,
  });

  // Fetch chronology entries
  const { data: entries, isLoading: isLoadingEntries, refetch: refetchEntries } = useQuery({
    queryKey: ['chronology', sessionId],
    queryFn: () => chronologyApi.list(sessionId).then((res) => res.data),
    enabled: !!sessionId,
    refetchInterval: 5000, // Fallback polling
  });

  // WebSocket for real-time updates
  useEffect(() => {
    if (!sessionId) return;

    const ws = createSessionWebSocket(sessionId);
    ws.connect();

    const unsubscribe = ws.on('new_entry', () => {
      queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
    });

    return () => {
      unsubscribe();
      ws.disconnect();
    };
  }, [sessionId, queryClient]);

  // ==========================================================================
  // Recording Functions
  // ==========================================================================

  const startRecording = useCallback(async () => {
    if (recordingState !== 'idle') return;

    try {
      setErrorMessage('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        processRecording();
      };

      mediaRecorder.start(100);
      recordingStartRef.current = Date.now();
      setRecordingState('recording');
      setRecordingDuration(0);

      // Update duration every 100ms
      recordingIntervalRef.current = setInterval(() => {
        if (recordingStartRef.current) {
          setRecordingDuration(
            Math.floor((Date.now() - recordingStartRef.current) / 1000)
          );
        }
      }, 100);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setErrorMessage('マイクへのアクセスに失敗しました');
    }
  }, [recordingState]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording' || !mediaRecorderRef.current) return;

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    mediaRecorderRef.current.stop();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [recordingState]);

  const processRecording = useCallback(async () => {
    if (audioChunksRef.current.length === 0) {
      setRecordingState('idle');
      return;
    }

    const startTime = recordingStartRef.current
      ? new Date(recordingStartRef.current).toISOString()
      : new Date().toISOString();
    const endTime = new Date().toISOString();
    const duration = recordingStartRef.current
      ? Math.floor((Date.now() - recordingStartRef.current) / 1000)
      : 0;

    // Skip if too short (< 500ms)
    if (duration < 0.5) {
      setRecordingState('idle');
      return;
    }

    setRecordingState('processing');

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];

    try {
      // First, save to IndexedDB for offline support
      const segment = await addToQueue({
        sessionId,
        speakerName: userSession?.speakerName || '',
        speakerId: userSession?.speakerId || '',
        audioBlob,
        startTime,
        endTime,
        duration,
      });

      // Add to upload history UI
      setUploadHistory((prev) => [
        {
          id: segment.localId,
          timestamp: startTime,
          status: 'uploading',
          duration,
          retryCount: 0,
        },
        ...prev.slice(0, 9),
      ]);

      // Update pending count
      const count = await getPendingCount(sessionId);
      setPendingCount(count);

      // If online, try to upload immediately
      if (navigator.onLine) {
        const result = await uploadSegment(segment);

        if (result.ok) {
          setUploadHistory((prev) =>
            prev.map((item) =>
              item.id === segment.localId ? { ...item, status: 'success' } : item
            )
          );
          queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
        } else {
          setUploadHistory((prev) =>
            prev.map((item) =>
              item.id === segment.localId
                ? { ...item, status: 'failed', errorMessage: result.error || '認識なし' }
                : item
            )
          );
        }
      } else {
        // Offline - mark as pending
        setUploadHistory((prev) =>
          prev.map((item) =>
            item.id === segment.localId ? { ...item, status: 'pending' } : item
          )
        );
      }

      // Update pending count after upload attempt
      const newCount = await getPendingCount(sessionId);
      setPendingCount(newCount);
    } catch (err: any) {
      console.error('Failed to process recording:', err);
      setErrorMessage(err.message || '録音の処理に失敗しました');
    } finally {
      setRecordingState('idle');
    }
  }, [sessionId, userSession?.speakerName, userSession?.speakerId, queryClient]);

  // ==========================================================================
  // Keyboard Event Handlers
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        startRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isLoggedIn || !userSession) {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/user/incident/${userSession.incidentId}`)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="font-semibold text-gray-900">
                  {sessionData?.title || '読み込み中...'}
                </h1>
                <p className="text-xs text-gray-500">
                  {userSession.incidentName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg">
                <Building2 className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">
                  {userSession.speakerName}
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
                  isOnline
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {isOnline ? (
                  <>
                    <Wifi className="h-4 w-4" />
                    <span>オンライン</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4" />
                    <span>オフライン</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* PTT Section */}
      <div className="bg-white border-b border-gray-200 sticky top-[57px] z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* Recording Button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={recordingState === 'processing'}
              className={`w-full max-w-md py-6 rounded-2xl font-semibold text-lg transition-all ${
                recordingState === 'recording'
                  ? 'bg-red-500 text-white shadow-lg scale-[1.02]'
                  : recordingState === 'processing'
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-800 text-white hover:bg-gray-700 active:bg-red-500'
              }`}
            >
              {recordingState === 'recording' ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="w-3 h-3 bg-white rounded-full animate-pulse" />
                  録音中... {formatDuration(recordingDuration)}
                </span>
              ) : recordingState === 'processing' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  送信中...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Mic className="h-5 w-5" />
                  Space を押して発話
                </span>
              )}
            </button>
            <p className="text-xs text-gray-500">
              Spaceキー長押し または ボタン長押しで録音
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mt-3 flex items-center justify-center gap-2 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Upload History + Pending Badge */}
          <div className="mt-4 flex items-center gap-2 justify-center flex-wrap">
            {/* Pending Badge */}
            {pendingCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-orange-100 text-orange-700">
                <Clock className="h-3 w-3" />
                <span>未送信: {pendingCount}件</span>
              </div>
            )}
            {/* History Items */}
            {uploadHistory.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                  item.status === 'success'
                    ? 'bg-green-100 text-green-700'
                    : item.status === 'uploading'
                    ? 'bg-blue-100 text-blue-700'
                    : item.status === 'failed'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {item.status === 'success' && <Check className="h-3 w-3" />}
                {item.status === 'uploading' && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {item.status === 'failed' && (
                  <AlertCircle className="h-3 w-3" />
                )}
                {item.status === 'pending' && (
                  <Clock className="h-3 w-3" />
                )}
                <span>
                  {format(new Date(item.timestamp), 'HH:mm:ss', { locale: ja })}
                </span>
                {item.status === 'failed' && (
                  <button
                    className="ml-1 underline"
                    onClick={() => {
                      // TODO: Implement retry
                    }}
                  >
                    再送
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chronology List */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">クロノロジー</h2>
          <button
            onClick={() => refetchEntries()}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className="h-4 w-4" />
            更新
          </button>
        </div>

        {isLoadingEntries ? (
          <div className="text-center py-8 text-gray-500">読み込み中...</div>
        ) : !entries || entries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            まだ記録がありません
          </div>
        ) : (
          <div className="space-y-3">
            {[...entries].reverse().map((entry) => (
              <ChronologyCard key={entry.entry_id} entry={entry} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// =============================================================================
// Chronology Card Component
// =============================================================================

function ChronologyCard({ entry }: { entry: ChronologyEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-start gap-3">
        {/* Time */}
        <div className="flex-shrink-0 text-xs text-gray-400 pt-0.5">
          {format(new Date(entry.timestamp), 'HH:mm', { locale: ja })}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                CATEGORY_STYLES[entry.category] || CATEGORY_STYLES['その他']
              }`}
            >
              {entry.category}
            </span>
            <span className="text-sm font-medium text-gray-700">
              {entry.hq_name || '未確定'}
            </span>
            {entry.has_task && (
              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">
                タスク
              </span>
            )}
          </div>

          {/* Summary */}
          <div className="text-sm font-medium text-gray-900 mb-1">
            {entry.summary}
          </div>

          {/* AI Note */}
          {entry.ai_note && (
            <div className="text-sm text-gray-600">{entry.ai_note}</div>
          )}

          {/* Expandable Raw Text */}
          {entry.text_raw && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-2"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  文字起こしを隠す
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  文字起こしを表示
                </>
              )}
            </button>
          )}
          {isExpanded && entry.text_raw && (
            <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-500">
              {entry.text_raw}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
