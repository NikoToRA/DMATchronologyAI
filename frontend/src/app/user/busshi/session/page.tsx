'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Mic,
  Wifi,
  WifiOff,
  Loader2,
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
} from '@/lib/audioQueue';
import { api, Participant } from '@/lib/api';

// =============================================================================
// Types
// =============================================================================

type RecordingState = 'idle' | 'recording' | 'sending';

interface BusshiSession {
  sessionId: string;
  speakerName: string;
  speakerId: string;
  hqId: string;
  incidentName: string;
}

// 無音判定の閾値（録音中の最大音量がこれ以下なら破棄）
const SILENCE_THRESHOLD = 5;

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

  // State - シンプル化
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [sendingCount, setSendingCount] = useState(0); // 送信中の件数

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
  const maxAudioLevelRef = useRef<number>(0); // 録音中の最大音量を記録

  // Chronology data using shared hook
  const {
    entries,
    participants,
    isEntriesLoading,
    updateEntry,
    stats,
  } = useChronology(sessionId);

  const { scrollRef } = useChronologyAutoScroll(entries);

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

    // 最大音量を更新
    if (level > maxAudioLevelRef.current) {
      maxAudioLevelRef.current = level;
    }

    if (recordingState === 'recording') {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [recordingState]);

  const startRecording = useCallback(async () => {
    if (recordingState !== 'idle') return;

    try {
      // 最大音量をリセット
      maxAudioLevelRef.current = 0;

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
      gainNode.gain.value = 3.0; // MAX固定
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
    }
  }, [recordingState, updateAudioLevel]);

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
  }, [recordingState]);

  // バックグラウンドで自動リトライ付きアップロード
  const uploadWithRetry = useCallback(async (segment: any) => {
    const maxRetries = 10;
    const retryDelay = 3000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // オンラインになるまで待つ
      while (!navigator.onLine) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      try {
        const result = await uploadSegment(segment);
        if (result.ok) {
          queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
          return true;
        }
        // 認識結果が空の場合は成功として扱う（無音だった）
        if (result.error?.includes('認識') || result.error?.includes('empty')) {
          return true;
        }
      } catch (err) {
        console.error(`Upload attempt ${attempt + 1} failed:`, err);
      }

      // リトライ前に待機
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    return false;
  }, [queryClient, sessionId]);

  const processRecording = useCallback(async () => {
    if (audioChunksRef.current.length === 0) {
      setRecordingState('idle');
      return;
    }

    const duration = recordingStartRef.current
      ? Math.floor((Date.now() - recordingStartRef.current) / 1000)
      : 0;

    // 短すぎる録音は破棄
    if (duration < 0.5) {
      setRecordingState('idle');
      return;
    }

    // 無音判定: 録音中の最大音量が閾値以下なら破棄
    if (maxAudioLevelRef.current < SILENCE_THRESHOLD) {
      console.log('Silent recording discarded, max level:', maxAudioLevelRef.current);
      audioChunksRef.current = [];
      setRecordingState('idle');
      return;
    }

    const startTime = recordingStartRef.current
      ? new Date(recordingStartRef.current).toISOString()
      : new Date().toISOString();
    const endTime = new Date().toISOString();

    // 送信中表示
    setRecordingState('sending');
    setSendingCount(prev => prev + 1);

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

      // すぐにidleに戻して次の録音を受け付け可能に
      setRecordingState('idle');

      // バックグラウンドでアップロード（自動リトライ付き）
      uploadWithRetry(segment).finally(() => {
        setSendingCount(prev => Math.max(0, prev - 1));
      });

    } catch (err: any) {
      console.error('Failed to process recording:', err);
      setRecordingState('idle');
      setSendingCount(prev => Math.max(0, prev - 1));
    }
  }, [sessionId, busshiSession?.speakerName, busshiSession?.speakerId, uploadWithRetry]);

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
                  isOnline ? 'bg-green-500' : 'bg-red-500'
                }`}
              >
                {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
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

      {/* PTT Section - シンプル化 */}
      <div className="bg-white border-b border-gray-200 sticky top-[60px] z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex flex-col items-center gap-3">
            {/* 録音ボタン */}
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={recordingState === 'sending'}
              className={`w-full max-w-md py-8 rounded-2xl font-bold text-xl transition-all ${
                recordingState === 'recording'
                  ? 'bg-red-500 text-white shadow-lg scale-[1.02]'
                  : recordingState === 'sending'
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-500 text-white hover:bg-yellow-600 active:bg-red-500'
              }`}
            >
              {recordingState === 'recording' ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="w-4 h-4 bg-white rounded-full animate-pulse" />
                  録音中... {formatDuration(recordingDuration)}
                </span>
              ) : recordingState === 'sending' ? (
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

            <p className="text-xs text-gray-500">
              Spaceキー長押し または ボタン長押し
            </p>

            {/* 送信中インジケーター（シンプルに） */}
            {sendingCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>送信中... ({sendingCount}件)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chronology List */}
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
