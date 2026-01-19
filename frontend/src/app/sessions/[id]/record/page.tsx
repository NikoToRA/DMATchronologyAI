'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mic,
  ArrowLeft,
  AlertCircle,
  Check,
  Loader2,
  Clock,
  User,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { sessionsApi, participantsApi, Participant, api } from '@/lib/api';

type RecordingState = 'idle' | 'recording' | 'processing';

interface ProcessedEntry {
  entry_id: string;
  category: string;
  summary: string;
  text_raw: string;
  hq_name: string | null;
  timestamp: string;
}

function guessAudioExtension(mimeType: string | undefined): string {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('audio/webm')) return 'webm';
  if (t.includes('audio/wav') || t.includes('audio/wave') || t.includes('audio/x-wav')) return 'wav';
  if (t.includes('audio/ogg')) return 'ogg';
  if (t.includes('audio/mpeg') || t.includes('audio/mp3')) return 'mp3';
  if (t.includes('audio/mp4') || t.includes('audio/x-m4a')) return 'm4a';
  return 'webm';
}

export default function RecordPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const sessionId = params.id as string;

  // State
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(''); // participant_id
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [lastResult, setLastResult] = useState<ProcessedEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [processedCount, setProcessedCount] = useState(0);
  const [lastSendStatus, setLastSendStatus] = useState<any>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Queries
  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId).then(res => res.data),
  });

  const { data: participants } = useQuery({
    queryKey: ['participants', sessionId],
    queryFn: () => participantsApi.list(sessionId).then(res => res.data),
  });

  const addSpeakerMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.post(`/api/sessions/${sessionId}/participants`, {
        zoom_display_name: name,
      });
      return response.data as Participant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participants', sessionId] });
    },
  });

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

  // Process and send recorded audio
  const cleanupRecordingResources = useCallback(() => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    mediaRecorderRef.current = null;
    analyserRef.current = null;

    audioChunksRef.current = [];
    recordingStartRef.current = null;
    silenceStartRef.current = null;
    setAudioLevel(0);
    setRecordingDuration(0);
  }, []);

  const processRecording = useCallback(
    async (recordedMimeType: string | undefined) => {
      if (audioChunksRef.current.length === 0) {
        setRecordingState('idle');
        cleanupRecordingResources();
        return;
      }

      setRecordingState('processing');

      try {
        const participantId = selectedSpeaker;
        if (!participantId) {
          setErrorMessage('発信者を選択してください');
          setRecordingState('idle');
          cleanupRecordingResources();
          return;
        }

        const mime = recordedMimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        audioChunksRef.current = [];

        const formData = new FormData();
        const ext = guessAudioExtension(mime);
        formData.append('audio', audioBlob, `recording.${ext}`);
        formData.append('participant_id', participantId);
        formData.append('timestamp', new Date().toISOString());

        const res = await api.post(`/api/zoom/audio/${sessionId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        });

        const result = res.data as any;
        setLastSendStatus(result);
        if (result && result.ok === false) {
          const stage = result.stage ? `(${result.stage}) ` : '';
          const reason =
            result.error ||
            (result.skipped ? '処理がスキップされました（無音/認識なし等）' : '処理に失敗しました');
          setErrorMessage(`${stage}${reason}`);
          setRecordingState('idle');
          cleanupRecordingResources();
          return;
        }

        // Get the latest chronology entry
        const chronologyResponse = await api.get(`/api/sessions/${sessionId}/chronology`);
        const entries = chronologyResponse.data;
        if (entries.length > 0) {
          setLastResult(entries[entries.length - 1]);
        } else if (result?.entry_id) {
          setErrorMessage(`(list) 保存は完了しましたが一覧取得で0件でした。entry_id=${result.entry_id}`);
        }

        setProcessedCount((prev) => prev + 1);
        queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
      } catch (err: unknown) {
        console.error('Failed to process audio:', err);
        const errorMsg =
          err instanceof Error ? err.message : typeof err === 'string' ? err : '音声処理に失敗しました';
        setErrorMessage(errorMsg);
      } finally {
        setRecordingState('idle');
        cleanupRecordingResources();
      }
    },
    [cleanupRecordingResources, queryClient, selectedSpeaker, sessionId]
  );

  const startRecording = useCallback(async () => {
    if (recordingState !== 'idle') return;

    if (!selectedSpeaker) {
      setErrorMessage('発信者を選択してください');
      return;
    }

    try {
      setErrorMessage('');
      setLastResult(null);
      setLastSendStatus(null);

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

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const chosenMime =
        candidates.find((t) => (typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported?.(t) : false)) ??
        '';

      const mediaRecorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (evt: any) => {
        const msg = evt?.error?.message ? String(evt.error.message) : 'MediaRecorder error';
        setErrorMessage(`MediaRecorderエラー: ${msg}`);
        setRecordingState('idle');
        cleanupRecordingResources();
      };

      mediaRecorder.onstop = () => {
        processRecording(mediaRecorder.mimeType);
      };

      mediaRecorder.start(100);
      recordingStartRef.current = Date.now();
      setRecordingState('recording');
      setRecordingDuration(0);

      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);

      recordingIntervalRef.current = setInterval(() => {
        if (recordingStartRef.current) {
          setRecordingDuration(Math.floor((Date.now() - recordingStartRef.current) / 1000));
        }
      }, 100);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setErrorMessage('録音初期化に失敗しました（マイク権限/MediaRecorder非対応の可能性）');
      setRecordingState('idle');
      cleanupRecordingResources();
    }
  }, [cleanupRecordingResources, processRecording, recordingState, selectedSpeaker, updateAudioLevel]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording' || !mediaRecorderRef.current) return;

    // Stop timers/UI updates first
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const durationMs = recordingStartRef.current ? Date.now() - recordingStartRef.current : 0;
    if (durationMs < 500) {
      // Too short -> discard
      audioChunksRef.current = [];
      setRecordingState('idle');
      cleanupRecordingResources();
      return;
    }

    try {
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.requestData();
      }
    } catch {
      // ignore
    }

    try {
      mediaRecorderRef.current.stop();
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'MediaRecorder.stop() failed';
      setErrorMessage(`録音停止に失敗しました: ${msg}`);
      setRecordingState('idle');
      cleanupRecordingResources();
    }
  }, [cleanupRecordingResources, recordingState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Keyboard PTT (Space press-and-hold)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/sessions/${sessionId}`}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            戻る
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">音声入力（プッシュ録音）</h1>
            <p className="text-sm text-gray-500">{session?.title}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Speaker Selection */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-gray-500" />
            話者（発信元）を選択
          </h2>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-500">
              災害ごとの参加者（Zoom表示名）から選びます。未登録なら追加してください。
            </div>
            <button
              onClick={async () => {
                const name = window.prompt('発信者名を入力してください（例：北海道庁調整本部、札幌医大病院活動支援指揮所）');
                if (!name || !name.trim()) return;
                const created = await addSpeakerMutation.mutateAsync(name.trim());
                setSelectedSpeaker(created.participant_id);
              }}
              disabled={addSpeakerMutation.isPending || recordingState !== 'idle'}
              className="text-sm text-primary-600 hover:text-primary-700 disabled:opacity-50"
            >
              ＋発信者を追加
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(participants ?? []).map((p) => (
              <button
                key={p.participant_id}
                onClick={() => setSelectedSpeaker(p.participant_id)}
                disabled={recordingState !== 'idle'}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  selectedSpeaker === p.participant_id
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                } ${recordingState !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="font-medium">{p.zoom_display_name}</div>
                {p.hq_name && <div className="text-xs text-gray-500 mt-0.5">{p.hq_name}</div>}
              </button>
            ))}
          </div>

          {(!participants || participants.length === 0) && (
            <p className="text-gray-500 text-center py-4">
              参加者がまだありません。
              <Link
                href={`/sessions/${sessionId}/participants`}
                className="text-primary-600 hover:underline ml-1"
              >
                Zoom参加者
              </Link>
              で追加するか、「＋発信者を追加」を使ってください。
            </p>
          )}
        </div>

        {/* Push-to-talk control */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Mic className="h-5 w-5 text-gray-500" />
            録音
          </h2>

          <div className="flex flex-col items-center gap-6">
            {lastSendStatus && (
              <div className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-700">
                <div className="font-semibold text-gray-800">直近の送信結果</div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>ok: {String(lastSendStatus.ok)}</div>
                  <div>stage: {String(lastSendStatus.stage ?? '-')}</div>
                  <div>rms_db: {lastSendStatus.rms_db ?? '-'}</div>
                  <div>stt_text_len: {lastSendStatus.stt_text_len ?? '-'}</div>
                  <div>stt_confidence: {lastSendStatus.stt_confidence ?? '-'}</div>
                  <div>stt_configured: {String(lastSendStatus.stt_configured ?? '-')}</div>
                  <div>audio_path: {lastSendStatus.audio_path ?? '-'}</div>
                  <div>segment_id: {lastSendStatus.segment_id ?? '-'}</div>
                  <div>entry_id: {lastSendStatus.entry_id ?? '-'}</div>
                  <div>error: {lastSendStatus.error ?? '-'}</div>
                </div>
              </div>
            )}

            {/* Volume Meter */}
            {recordingState === 'recording' && (
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">音量レベル</span>
                  <span className="text-sm font-mono text-gray-600">
                    {audioLevel}%
                  </span>
                </div>
                <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      audioLevel > 70 ? 'bg-red-500' : audioLevel > 40 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-400">
                  <span>無音</span>
                  <span>|</span>
                  <span>検知</span>
                </div>
              </div>
            )}

            {/* Status Display */}
            {recordingState === 'recording' && (
              <div className="flex items-center gap-3 text-red-600">
                <Volume2 className="h-6 w-6 animate-pulse" />
                <span className="text-2xl font-mono">{formatDuration(recordingDuration)}</span>
                <span className="text-lg">録音中（離すと送信）</span>
              </div>
            )}

            {recordingState === 'processing' && (
              <div className="flex items-center gap-3 text-blue-600">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>送信中...</span>
              </div>
            )}

            {/* Control Buttons */}
            <div className="flex gap-4">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={!selectedSpeaker || recordingState === 'processing'}
                className={`flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium text-lg transition-all ${
                  !selectedSpeaker
                    ? 'bg-gray-300 cursor-not-allowed'
                    : recordingState === 'recording'
                      ? 'bg-red-500 hover:bg-red-600'
                      : recordingState === 'processing'
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-800 hover:bg-gray-900 active:bg-red-500'
                }`}
              >
                <Mic className="h-6 w-6" />
                {recordingState === 'recording' ? '録音中...' : '押して録音（Space長押し）'}
              </button>
            </div>

            {/* Stats */}
            {processedCount > 0 && (
              <div className="text-sm text-gray-500">
                処理済み: {processedCount} 件
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                <AlertCircle className="h-5 w-5" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        {/* Last Result */}
        {lastResult && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              最新のクロノロジー
            </h2>
            <div className="space-y-3 bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="h-4 w-4" />
                {format(new Date(lastResult.timestamp), 'HH:mm:ss', { locale: ja })}
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${getCategoryStyle(lastResult.category)}`}>
                  {lastResult.category}
                </span>
                <span className="font-medium">{lastResult.hq_name || '未確定'}</span>
              </div>
              <div className="font-medium text-gray-900">{lastResult.summary}</div>
              <div className="text-sm text-gray-500">{lastResult.text_raw}</div>
            </div>
            <div className="mt-4">
              <Link
                href={`/sessions/${sessionId}/chronology`}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 inline-block"
              >
                クロノロジー一覧を見る
              </Link>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
          <h3 className="font-semibold mb-2">使い方</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>話者（発信元の本部）を選択</li>
            <li>ボタンを押している間（またはSpaceキー長押し中）だけ録音</li>
            <li>ボタン/Spaceを離すと送信</li>
            <li>クロノロジーに登録されます</li>
          </ol>
          <div className="mt-3 text-blue-600 space-y-1">
            <p>※ 管理用途のため「自動検知（VAD）」ではなく、明示操作での録音にしています</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function getCategoryStyle(category: string): string {
  const styles: Record<string, string> = {
    '指示': 'bg-red-100 text-red-800',
    '依頼': 'bg-yellow-100 text-yellow-800',
    '報告': 'bg-blue-100 text-blue-800',
    '決定': 'bg-green-100 text-green-800',
    '確認': 'bg-purple-100 text-purple-800',
    'リスク': 'bg-orange-100 text-orange-800',
    'その他': 'bg-gray-100 text-gray-800',
  };
  return styles[category] || styles['その他'];
}
