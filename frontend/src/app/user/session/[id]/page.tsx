'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowLeft,
  Building2,
  Mic,
  Wifi,
  WifiOff,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  Settings,
  Volume2,
  LogOut,
} from 'lucide-react';
import { useUserSession } from '@/contexts/UserSessionContext';
import { useChronology, useChronologyAutoScroll } from '@/hooks';
import {
  ChronologyFilters,
  ChronologyEntryList,
  ChronologyFooter,
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

// =============================================================================
// Main Component
// =============================================================================

export default function UserSessionPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionId = params.id as string;
  const { session: userSession, isLoggedIn, logout, updateSpeakerId } = useUserSession();
  const [isRegistering, setIsRegistering] = useState(false);

  // State
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pendingCount, setPendingCount] = useState(0);
  const [micGain, setMicGain] = useState(1.5);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
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
    hqMaster,
    isEntriesLoading,
    updateEntry,
    filters,
    setFilters,
    refetch,
    stats,
  } = useChronology(sessionId);

  const { scrollRef, autoScroll, setAutoScroll } = useChronologyAutoScroll(entries);

  // Filter handlers
  const handleCategoryChange = useCallback(
    (category: typeof filters.category) => {
      setFilters({ category });
    },
    [setFilters]
  );

  const handleHqChange = useCallback(
    (hqId: string) => {
      setFilters({ hqId });
    },
    [setFilters]
  );

  const handleUnconfirmedOnlyChange = useCallback(
    (unconfirmedOnly: boolean) => {
      setFilters({ unconfirmedOnly });
    },
    [setFilters]
  );

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/user');
    }
  }, [isLoggedIn, router]);

  // Register participant in this session if not already registered
  useEffect(() => {
    if (!isLoggedIn || !userSession || !sessionId || !participants) return;
    if (isRegistering) return;

    // Check if current speakerId exists in this session's participants
    const existingParticipant = participants.find(
      (p) => p.participant_id === userSession.speakerId
    );

    if (!existingParticipant) {
      // Need to register in this session
      setIsRegistering(true);
      api
        .post<Participant>(`/api/sessions/${sessionId}/participants`, {
          zoom_display_name: userSession.speakerName,
        })
        .then((response) => {
          const newParticipant = response.data;
          updateSpeakerId(newParticipant.participant_id);
          queryClient.invalidateQueries({ queryKey: ['participants', sessionId] });
          console.log('Registered participant in session:', newParticipant.participant_id);
        })
        .catch((err) => {
          console.error('Failed to register participant:', err);
          setErrorMessage('セッションへの参加登録に失敗しました');
        })
        .finally(() => {
          setIsRegistering(false);
        });
    }
  }, [isLoggedIn, userSession, sessionId, participants, isRegistering, updateSpeakerId, queryClient]);

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

    // IMPORTANT: Use the actual MediaRecorder mimeType.
    // Some environments produce non-webm containers; forcing 'audio/webm' can corrupt downstream decoding.
    const recordedMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
    audioChunksRef.current = [];

    try {
      const segment = await addToQueue({
        sessionId,
        speakerName: userSession?.speakerName || '',
        speakerId: userSession?.speakerId || '',
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
  }, [sessionId, userSession?.speakerName, userSession?.speakerId, queryClient]);

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
        // Use latest participant_id for this session (older queued segments may have stale participant_id)
        const result = await retrySegment(localId, userSession?.speakerId);

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
    [retryingId, sessionId, queryClient, userSession?.speakerId]
  );

  // Retry all pending uploads
  const handleRetryAll = useCallback(async () => {
    if (retryingAll || pendingCount === 0) return;

    setRetryingAll(true);
    setErrorMessage('');

    try {
      // Ensure queued segments use the current participant_id (session-scoped)
      if (userSession?.speakerId) {
        await rebindSegmentsToParticipant(sessionId, userSession.speakerId, userSession.speakerName);
      }
      // Reset statuses/retryCount so stuck segments can be re-attempted immediately
      await resetSegmentsForRetry(sessionId);
      // forceRetry=true to skip delay checks and include stuck 'uploading' segments
      const result = await processQueue(sessionId, true);

      if (result.success > 0) {
        queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
      }

      // Update pending count
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
  }, [retryingAll, pendingCount, sessionId, queryClient, userSession?.speakerId, userSession?.speakerName]);

  // Logout handler
  const handleLogout = useCallback(() => {
    logout();
    router.push('/user');
  }, [logout, router]);

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
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                title="ログアウト"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">ログアウト</span>
              </button>
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

            {/* Audio Level Meter */}
            {recordingState === 'recording' && (
              <div className="w-full max-w-md">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-gray-400" />
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
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

            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500">
                Spaceキー長押し または ボタン長押しで録音
              </p>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title="マイク設定"
              >
                <Settings className="h-4 w-4 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Microphone Settings Panel */}
          {showSettings && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg max-w-md mx-auto">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">マイク感度</span>
                <span className="text-sm text-gray-500">{micGain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={micGain}
                onChange={(e) => setMicGain(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>低</span>
                <span>標準</span>
                <span>高</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                音声が小さい場合は感度を上げてください
              </p>
            </div>
          )}

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
                  className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    {retryingId === item.id ? '再送中...' : '再送'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters - same as admin */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto">
          <ChronologyFilters
            filters={filters}
            participants={participants}
            hqMaster={hqMaster}
            onCategoryChange={handleCategoryChange}
            onHqChange={handleHqChange}
            onUnconfirmedOnlyChange={handleUnconfirmedOnlyChange}
          />
        </div>
      </div>

      {/* Chronology List - same as admin */}
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

      {/* Footer Stats - same as admin */}
      <div className="bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto">
          <ChronologyFooter stats={stats} />
        </div>
      </div>
    </div>
  );
}
