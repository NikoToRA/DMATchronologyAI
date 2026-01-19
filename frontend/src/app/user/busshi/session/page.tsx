'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Building2,
  Mic,
  Wifi,
  WifiOff,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  Volume2,
  LogOut,
  Package,
} from 'lucide-react';
import { useChronology, useChronologyAutoScroll } from '@/hooks';
import {
  ChronologyEntryList,
} from '@/components/chronology';
import {
  addToQueue,
  uploadSegment,
  getPendingCount,
  startQueueProcessor,
  stopQueueProcessor,
  retrySegment,
  processQueue,
  resetSegmentsForRetry,
  rebindSegmentsToParticipant,
} from '@/lib/audioQueue';
import { api, Participant } from '@/lib/api';

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

interface BusshiSession {
  sessionId: string;
  speakerName: string;
  speakerId: string;
  hqId: string;
  incidentName: string;
}

// =============================================================================
// Main Component
// =============================================================================

export default function BusshiSessionPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Load session from localStorage
  const [busshiSession, setBusshiSession] = useState<BusshiSession | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('busshi_session');
    if (stored) {
      setBusshiSession(JSON.parse(stored));
    } else {
      router.push('/user/busshi');
    }
  }, [router]);

  const sessionId = busshiSession?.sessionId || '';

  // State - mic gain default MAX (3.0)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pendingCount, setPendingCount] = useState(0);
  const [micGain] = useState(3.0); // MAX固定
  const [audioLevel, setAudioLevel] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Chronology data using shared hook
  const {
    entries,
    session: sessionData,
    participants,
    isEntriesLoading,
    updateEntry,
    filters,
    setFilters,
    refetch,
    stats,
  } = useChronology(sessionId);

  const { scrollRef, autoScroll, setAutoScroll } = useChronologyAutoScroll(entries);

  // Register participant in this session if not already registered
  useEffect(() => {
    if (!busshiSession || !sessionId || !participants) return;
    if (isRegistering) return;

    const existingParticipant = participants.find(
      (p) => p.participant_id === busshiSession.speakerId
    );

    if (!existingParticipant) {
      setIsRegistering(true);
      api
        .post<Participant>(`/api/sessions/${sessionId}/participants`, {
          zoom_display_name: busshiSession.speakerName,
          hq_id: busshiSession.hqId,
        })
        .then((response) => {
          const newParticipant = response.data;
          const updated = { ...busshiSession, speakerId: newParticipant.participant_id };
          setBusshiSession(updated);
          localStorage.setItem('busshi_session', JSON.stringify(updated));
          queryClient.invalidateQueries({ queryKey: ['participants', sessionId] });
        })
        .catch((err) => {
          console.error('Failed to register participant:', err);
          setErrorMessage('セッションへの参加登録に失敗しました');
        })
        .finally(() => {
          setIsRegistering(false);
        });
    }
  }, [busshiSession, sessionId, participants, isRegistering, queryClient]);

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
    if (!sessionId) return;

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

  // ==========================================================================
  // Recording Functions
  // ==========================================================================

  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    const sum = dataArray.reduce((a, b) => a + b, 0);
    const avg = sum / dataArray.length;
    const level = Math.min(100, Math.round((avg / 255) * 100 * 1.5));

    setAudioLevel(level);

    if (recordingState === 'recording') {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [recordingState]);

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
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = micGain;
      gainNodeRef.current = gainNode;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const dest = audioContext.createMediaStreamDestination();

      source.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(dest);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(dest.stream, { mimeType });
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

      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);

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
  }, [recordingState, micGain, updateAudioLevel]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording' || !mediaRecorderRef.current) return;

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    mediaRecorderRef.current.stop();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAudioLevel(0);
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

    if (duration < 0.5) {
      setRecordingState('idle');
      return;
    }

    setRecordingState('processing');

    const recordedMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
    audioChunksRef.current = [];

    try {
      const segment = await addToQueue({
        sessionId,
        speakerName: busshiSession?.speakerName || '',
        speakerId: busshiSession?.speakerId || '',
        audioBlob,
        startTime,
        endTime,
        duration,
      });

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

      const count = await getPendingCount(sessionId);
      setPendingCount(count);

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
        setUploadHistory((prev) =>
          prev.map((item) =>
            item.id === segment.localId ? { ...item, status: 'pending' } : item
          )
        );
      }

      const newCount = await getPendingCount(sessionId);
      setPendingCount(newCount);
    } catch (err: any) {
      console.error('Failed to process recording:', err);
      setErrorMessage(err.message || '録音の処理に失敗しました');
    } finally {
      setRecordingState('idle');
    }
  }, [sessionId, busshiSession?.speakerName, busshiSession?.speakerId, queryClient]);

  // Retry failed upload
  const handleRetry = useCallback(
    async (localId: string) => {
      if (retryingId) return;

      setRetryingId(localId);
      setUploadHistory((prev) =>
        prev.map((item) =>
          item.id === localId ? { ...item, status: 'uploading' } : item
        )
      );

      try {
        const result = await retrySegment(localId, busshiSession?.speakerId);

        if (result.ok) {
          setUploadHistory((prev) =>
            prev.map((item) =>
              item.id === localId ? { ...item, status: 'success' } : item
            )
          );
          queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
        } else {
          setUploadHistory((prev) =>
            prev.map((item) =>
              item.id === localId
                ? { ...item, status: 'failed', errorMessage: result.error, retryCount: item.retryCount + 1 }
                : item
            )
          );
        }
      } catch (err: any) {
        setUploadHistory((prev) =>
          prev.map((item) =>
            item.id === localId
              ? { ...item, status: 'failed', errorMessage: err.message }
              : item
          )
        );
      } finally {
        setRetryingId(null);
        const newCount = await getPendingCount(sessionId);
        setPendingCount(newCount);
      }
    },
    [retryingId, sessionId, queryClient, busshiSession?.speakerId]
  );

  // Retry all pending uploads
  const handleRetryAll = useCallback(async () => {
    if (retryingAll || pendingCount === 0) return;

    setRetryingAll(true);
    setErrorMessage('');

    try {
      if (busshiSession?.speakerId) {
        await rebindSegmentsToParticipant(sessionId, busshiSession.speakerId, busshiSession.speakerName);
      }
      await resetSegmentsForRetry(sessionId);
      const result = await processQueue(sessionId, true);

      if (result.success > 0) {
        queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
      }

      const newCount = await getPendingCount(sessionId);
      setPendingCount(newCount);

      if (result.success > 0 && result.failed === 0) {
        setErrorMessage('');
      } else if (result.failed > 0) {
        setErrorMessage(`${result.failed}件の送信に失敗しました`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || '再送信に失敗しました');
    } finally {
      setRetryingAll(false);
    }
  }, [retryingAll, pendingCount, sessionId, queryClient, busshiSession?.speakerId, busshiSession?.speakerName]);

  // Logout handler
  const handleLogout = useCallback(() => {
    localStorage.removeItem('busshi_session');
    router.push('/user/busshi');
  }, [router]);

  // ==========================================================================
  // Keyboard Event Handlers
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  if (!busshiSession) {
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
      <header className="bg-yellow-500 text-white sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="h-6 w-6" />
              <div>
                <h1 className="font-bold text-lg">物資支援班</h1>
                <p className="text-xs text-yellow-100">
                  2026年DMAT関東ブロック訓練
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-yellow-600 px-3 py-1.5 rounded-lg">
                <Building2 className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {busshiSession.speakerName}
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
                  isOnline
                    ? 'bg-green-500'
                    : 'bg-red-500'
                }`}
              >
                {isOnline ? (
                  <Wifi className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-yellow-600 hover:bg-yellow-700 transition-colors"
                title="ログアウト"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* PTT Section */}
      <div className="bg-white border-b border-gray-200 sticky top-[60px] z-10">
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
              className={`w-full max-w-md py-8 rounded-2xl font-bold text-xl transition-all ${
                recordingState === 'recording'
                  ? 'bg-red-500 text-white shadow-lg scale-[1.02]'
                  : recordingState === 'processing'
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-500 text-white hover:bg-yellow-600 active:bg-red-500'
              }`}
            >
              {recordingState === 'recording' ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="w-4 h-4 bg-white rounded-full animate-pulse" />
                  録音中... {formatDuration(recordingDuration)}
                </span>
              ) : recordingState === 'processing' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  送信中...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Mic className="h-6 w-6" />
                  押して発話
                </span>
              )}
            </button>

            {/* Audio Level Meter */}
            {recordingState === 'recording' && (
              <div className="w-full max-w-md">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-gray-400" />
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-75 ${
                        audioLevel > 70 ? 'bg-red-500' : audioLevel > 40 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8">{audioLevel}%</span>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Spaceキー長押し または ボタン長押し
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
            {pendingCount > 0 && (
              <>
                <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-orange-100 text-orange-700">
                  <Clock className="h-3 w-3" />
                  <span>未送信: {pendingCount}件</span>
                </div>
                <button
                  onClick={handleRetryAll}
                  disabled={retryingAll}
                  className="px-2 py-1 rounded text-xs bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {retryingAll ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      送信中...
                    </span>
                  ) : (
                    '全て再送'
                  )}
                </button>
              </>
            )}
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
                    className="ml-1 underline hover:no-underline"
                    onClick={() => handleRetry(item.id)}
                    disabled={retryingId === item.id}
                  >
                    {retryingId === item.id ? '...' : '再送'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chronology List - シンプルにフィルターなし */}
      <main className="flex-1 max-w-4xl mx-auto w-full">
        <ChronologyEntryList
          entries={entries}
          isLoading={isEntriesLoading}
          scrollRef={scrollRef}
          onUpdateEntry={updateEntry}
          participants={participants}
          sessionId={sessionId}
        />
      </main>

      {/* Simple Footer */}
      <div className="bg-white border-t border-gray-200 py-3">
        <div className="max-w-4xl mx-auto px-4 text-center text-sm text-gray-500">
          全{stats.total}件
        </div>
      </div>
    </div>
  );
}
