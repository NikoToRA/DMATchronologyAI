'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mic, MicOff, ArrowLeft, AlertCircle, Check, Loader2,
  Radio, Clock, User, Volume2, VolumeX
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { sessionsApi, participantsApi, Participant, api } from '@/lib/api';

type ListeningState = 'idle' | 'listening' | 'recording' | 'processing' | 'success' | 'error';

interface ProcessedEntry {
  entry_id: string;
  category: string;
  summary: string;
  text_raw: string;
  hq_name: string | null;
  timestamp: string;
}

// Voice Activity Detection defaults
// NOTE: If "silence" sits around -50dB (noisy room / AGC), using -60/-75 will never stop.
// These defaults aim to work in that environment out-of-the-box.
const DEFAULT_VAD = {
  speechThresholdDb: -40,        // start when clearly above noise floor (e.g. noise -50, voice -20~-30)
  silenceThresholdDb: -45,       // treat around/below noise floor as "silence" to allow stopping
  silenceDurationMs: 1800,       // stop after this much "silence" to reduce latency
  minRecordingDurationMs: 700,   // shorter => accept shorter utterances
  maxRecordingDurationMs: 10000, // force-send chunk even if silence is never reached
} as const;

type VadPreset = 'zoom' | 'quiet';
const VAD_PRESETS: Record<VadPreset, typeof DEFAULT_VAD> = {
  zoom: DEFAULT_VAD,
  quiet: {
    speechThresholdDb: -50,
    silenceThresholdDb: -60,
    silenceDurationMs: 2000,
    minRecordingDurationMs: 900,
    maxRecordingDurationMs: 12000,
  },
} as const;

export default function RecordPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionId = params.id as string;

  // State
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(''); // participant_id
  const [currentVolume, setCurrentVolume] = useState<number>(-100);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [lastResult, setLastResult] = useState<ProcessedEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [processedCount, setProcessedCount] = useState(0);
  const [vad, setVad] = useState(() => ({ ...DEFAULT_VAD }));
  const [lastSendStatus, setLastSendStatus] = useState<any>(null);
  const [lastStopReason, setLastStopReason] = useState<string>('');
  const [lastRecorderError, setLastRecorderError] = useState<string>('');

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastChunkSizeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const vadRef = useRef(vad);

  useEffect(() => {
    vadRef.current = vad;
  }, [vad]);

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

  // Calculate volume in dB from analyser data (time-domain RMS; more stable for VAD)
  const calculateVolume = useCallback(() => {
    if (!analyserRef.current) return -100;

    // Use time domain waveform (-1..1) instead of frequency bins to avoid "always loud" readings.
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i];
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    // Convert to dBFS (0 = full scale, smaller/negative = quieter)
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    return Math.max(-100, Math.min(0, db));
  }, []);

  // Process and send recorded audio
  const processRecording = useCallback(async () => {
    if (audioChunksRef.current.length === 0) return;

    setListeningState('processing');

    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];

      const participantId = selectedSpeaker;
      if (!participantId) {
        setErrorMessage('発信者を選択してください');
        setListeningState('error');
        return;
      }

      // Send to API
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('participant_id', participantId);
      formData.append('timestamp', new Date().toISOString());

      const res = await api.post(
        `/api/zoom/audio/${sessionId}`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        }
      );

      const result = res.data as any;
      setLastSendStatus(result);
      if (result && result.ok === false) {
        const stage = result.stage ? `(${result.stage}) ` : '';
        const reason =
          result.error ||
          (result.skipped ? '処理がスキップされました（無音/認識なし等）' : '処理に失敗しました');
        setErrorMessage(`${stage}${reason}`);
        // Skips (e.g., stt_text_len=0) are common in noisy environments; keep listening.
        if (result.skipped) {
          setListeningState('recording');
          return;
        }
        setListeningState('error');
        return;
      }

      // Get the latest chronology entry
      const chronologyResponse = await api.get(`/api/sessions/${sessionId}/chronology`);
      const entries = chronologyResponse.data;
      if (entries.length > 0) {
        setLastResult(entries[entries.length - 1]);
      } else if (result?.entry_id) {
        // Backend says it created an entry, but list is empty: show a helpful warning.
        setErrorMessage(`(list) 保存は完了しましたが一覧取得で0件でした。entry_id=${result.entry_id}`);
      }

      setProcessedCount(prev => prev + 1);
      queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });

      // Continue monitoring: restart recorder so it doesn't stay inactive after a stop.
      try {
        if (mediaRecorderRef.current && streamRef.current) {
          audioChunksRef.current = [];
          lastChunkSizeRef.current = 0;
          mediaRecorderRef.current.start(100);
          isRecordingRef.current = true;
          recordingStartRef.current = Date.now();
          silenceStartRef.current = null;
          setListeningState('recording');
          setRecordingDuration(0);
        } else {
          setListeningState('listening');
        }
      } catch {
        // If restart fails, fall back to listening state (user can restart manually)
        setListeningState('listening');
      }

    } catch (err: unknown) {
      console.error('Failed to process audio:', err);
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : '音声処理に失敗しました';
      setErrorMessage(errorMsg);
      setListeningState('error');
    }
  }, [sessionId, selectedSpeaker, queryClient]);

  // Start recording (called when speech detected)
  const startRecording = useCallback(() => {
    if (!mediaRecorderRef.current || isRecordingRef.current) return;

    console.log('Speech detected - starting recording');
    audioChunksRef.current = [];
    try {
      mediaRecorderRef.current.start(100);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'MediaRecorder.start() failed';
      setLastRecorderError(msg);
      setErrorMessage(`録音開始に失敗しました: ${msg}`);
      setListeningState('error');
      return;
    }
    isRecordingRef.current = true;
    recordingStartRef.current = Date.now();
    silenceStartRef.current = null;
    setListeningState('recording');
    setRecordingDuration(0);
  }, []);

  // Stop recording (called when silence/max/force)
  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current || !isRecordingRef.current) return;

    const recordingDuration = recordingStartRef.current
      ? Date.now() - recordingStartRef.current
      : 0;

    // Only process if recording was long enough
    if (recordingDuration < vadRef.current.minRecordingDurationMs) {
      console.log('Recording too short, discarding');
      audioChunksRef.current = [];
      isRecordingRef.current = false;
      setListeningState('listening');
      return;
    }

    console.log('Stopping recording');
    try {
      // Flush any buffered data before stopping (important on some browsers)
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
      setLastRecorderError(msg);
      setErrorMessage(`録音停止に失敗しました: ${msg}`);
      setListeningState('error');
      return;
    }
    isRecordingRef.current = false;
  }, []);

  // Force stop+send (useful for debugging/noisy environments)
  const forceSend = useCallback(() => {
    if (!mediaRecorderRef.current) {
      setErrorMessage('MediaRecorderが初期化されていません（ブラウザ非対応の可能性）');
      return;
    }
    if (!isRecordingRef.current) {
      setErrorMessage('まだ録音が開始されていません（話し始めで録音開始→その後に強制送信できます）');
      return;
    }
    setLastStopReason('force');
    stopRecording();
  }, [listeningState, stopRecording]);

  // Voice Activity Detection loop
  const vadLoop = useCallback(() => {
    const volume = calculateVolume();
    setCurrentVolume(volume);

    const now = Date.now();

    if (listeningState === 'listening' || listeningState === 'recording') {
      if (!isRecordingRef.current) {
        // Not recording - check for speech start
        if (volume > vadRef.current.speechThresholdDb) {
          startRecording();
        }
      } else {
        // Recording - check for silence
        if (volume < vadRef.current.silenceThresholdDb) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > vadRef.current.silenceDurationMs) {
            setLastStopReason('silence');
            stopRecording();
          }
        } else {
          silenceStartRef.current = null;
        }

        // Force-stop after max duration to ensure we periodically send chunks even with background noise.
        if (
          recordingStartRef.current &&
          now - recordingStartRef.current > vadRef.current.maxRecordingDurationMs
        ) {
          setLastStopReason('max');
          stopRecording();
          silenceStartRef.current = null;
        }

        // Update recording duration
        if (recordingStartRef.current) {
          setRecordingDuration(Math.floor((now - recordingStartRef.current) / 1000));
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(vadLoop);
  }, [listeningState, calculateVolume, startRecording, stopRecording]);

  // Start listening (initialize audio context and start VAD)
  const startListening = useCallback(async () => {
    if (!selectedSpeaker) {
      setErrorMessage('話者を選択してください');
      return;
    }

    try {
      setErrorMessage('');
      setLastResult(null);

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      // Setup audio context and analyser for VAD
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Setup media recorder
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ];
      const chosenMime =
        candidates.find((t) => (typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported?.(t) : false)) ??
        '';
      const mediaRecorder = new MediaRecorder(
        stream,
        chosenMime ? { mimeType: chosenMime } : undefined
      );
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.onstart = () => {
        // keep UI in sync even if start was delayed
        setLastRecorderError('');
      };
      mediaRecorder.onerror = (evt: any) => {
        const msg = evt?.error?.message ? String(evt.error.message) : 'MediaRecorder error';
        setLastRecorderError(msg);
        setErrorMessage(`MediaRecorderエラー: ${msg}`);
        setListeningState('error');
      };
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          lastChunkSizeRef.current = event.data.size;
        }
      };

      mediaRecorder.onstop = () => {
        processRecording();
      };

      // IMPORTANT: Start recording immediately from the user gesture ("監視開始") so it works reliably
      // across browsers. VAD still decides when to stop+send.
      try {
        audioChunksRef.current = [];
        mediaRecorder.start(100);
        isRecordingRef.current = true;
        recordingStartRef.current = Date.now();
        silenceStartRef.current = null;
        setListeningState('recording');
        setRecordingDuration(0);
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : 'MediaRecorder.start() failed';
        setLastRecorderError(msg);
        setErrorMessage(`録音開始に失敗しました: ${msg}`);
        setListeningState('error');
        return;
      }

      // Start VAD loop
      animationFrameRef.current = requestAnimationFrame(vadLoop);

    } catch (err) {
      console.error('Failed to start listening:', err);
      setErrorMessage('録音初期化に失敗しました（マイク権限/MediaRecorder非対応の可能性）');
      setListeningState('error');
    }
  }, [selectedSpeaker, vadLoop, processRecording]);

  // Stop listening
  const stopListening = useCallback(() => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setListeningState('idle');
    setCurrentVolume(-100);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  // Restart VAD loop when state changes to listening
  useEffect(() => {
    if (listeningState === 'listening' && analyserRef.current && !animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(vadLoop);
    }
  }, [listeningState, vadLoop]);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Volume meter display
  const getVolumeBarWidth = () => {
    const normalized = (currentVolume + 100) / 100;
    return `${Math.max(0, Math.min(100, normalized * 100))}%`;
  };

  const getVolumeColor = () => {
    // Use current VAD thresholds so the meter reflects what will trigger recording.
    if (currentVolume > vad.speechThresholdDb) return 'bg-green-500';
    if (currentVolume > vad.silenceThresholdDb) return 'bg-yellow-500';
    return 'bg-gray-400';
  };

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
            <h1 className="text-xl font-bold text-gray-900">音声自動検知</h1>
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
              disabled={addSpeakerMutation.isPending || listeningState !== 'idle'}
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
                disabled={listeningState !== 'idle'}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  selectedSpeaker === p.participant_id
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                } ${listeningState !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''}`}
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

        {/* Listening Control */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Mic className="h-5 w-5 text-gray-500" />
            音声監視
          </h2>

          {/* VAD tuning */}
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-800">検知感度（VAD）</div>
                <div className="mt-1 text-xs text-gray-500">
                  Zoom/現場の騒音を想定して、多少ノイズが入っても録音される方向に調整できます。
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVad({ ...VAD_PRESETS.zoom })}
                  disabled={listeningState !== 'idle'}
                  className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                >
                  Zoom想定
                </button>
                <button
                  onClick={() => setVad({ ...VAD_PRESETS.quiet })}
                  disabled={listeningState !== 'idle'}
                  className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                >
                  静かな環境
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <VadSlider
                label="開始しきい値（話し始め）"
                value={vad.speechThresholdDb}
                min={-90}
                max={-10}
                step={1}
                disabled={listeningState !== 'idle'}
                hint="小さい声で開始しない場合は、より小さい値（例：-70）へ"
                onChange={(v) => setVad((prev) => ({ ...prev, speechThresholdDb: v }))}
              />
              <VadSlider
                label="停止しきい値（無音判定）"
                value={vad.silenceThresholdDb}
                min={-100}
                max={-20}
                step={1}
                disabled={listeningState !== 'idle'}
                hint="途中で切れやすい場合は、より小さい値（例：-80）へ"
                onChange={(v) => setVad((prev) => ({ ...prev, silenceThresholdDb: v }))}
              />
              <VadSlider
                label="無音継続（停止まで）"
                value={vad.silenceDurationMs}
                min={800}
                max={5000}
                step={100}
                disabled={listeningState !== 'idle'}
                suffix="ms"
                hint="Zoomの間や言い直しが多い場合は長めに"
                onChange={(v) => setVad((prev) => ({ ...prev, silenceDurationMs: v }))}
              />
              <VadSlider
                label="最低録音時間（短い録音を捨てる）"
                value={vad.minRecordingDurationMs}
                min={200}
                max={2000}
                step={100}
                disabled={listeningState !== 'idle'}
                suffix="ms"
                hint="短い相づちも拾いたいなら短めに"
                onChange={(v) => setVad((prev) => ({ ...prev, minRecordingDurationMs: v }))}
              />
              <VadSlider
                label="最大録音時間（強制送信）"
                value={vad.maxRecordingDurationMs}
                min={3000}
                max={30000}
                step={1000}
                disabled={listeningState !== 'idle'}
                suffix="ms"
                hint="無音になりにくい環境（Zoom/騒音）では短め（例：10-15秒）がおすすめ"
                onChange={(v) => setVad((prev) => ({ ...prev, maxRecordingDurationMs: v }))}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-6">
            <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">
                  状態: <span className="font-mono">{listeningState}</span>
                </div>
                <button
                  onClick={forceSend}
                  disabled={!isRecordingRef.current}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  今すぐ送信（強制）
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                送信は「録音停止」で発生します。無音が止まらない（ノイズが-50付近）場合は、開始しきい値を-40前後、停止しきい値を-45前後にすると止まりやすいです。
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <div>rec_state: {mediaRecorderRef.current?.state ?? '-'}</div>
                <div>mime: {mediaRecorderRef.current?.mimeType ?? '-'}</div>
                <div>isRecording: {String(isRecordingRef.current)}</div>
                <div>chunks: {audioChunksRef.current.length}</div>
                <div>lastChunkSize: {lastChunkSizeRef.current || '-'}</div>
                <div>lastStop: {lastStopReason || '-'}</div>
                <div className="col-span-2">rec_error: {lastRecorderError || '-'}</div>
              </div>
            </div>

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
            {(listeningState === 'listening' || listeningState === 'recording') && (
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">音量レベル</span>
                  <span className="text-sm font-mono text-gray-600">
                    {currentVolume.toFixed(0)} dB
                  </span>
                </div>
                <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${getVolumeColor()}`}
                    style={{ width: getVolumeBarWidth() }}
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
            {listeningState === 'listening' && (
              <div className="flex items-center gap-3 text-blue-600">
                <Volume2 className="h-6 w-6 animate-pulse" />
                <span className="text-lg">音声待機中...</span>
              </div>
            )}

            {listeningState === 'recording' && (
              <div className="flex items-center gap-3 text-red-600">
                <Radio className="h-6 w-6 animate-pulse" />
                <span className="text-2xl font-mono">{formatDuration(recordingDuration)}</span>
                <span className="text-lg">録音中...</span>
              </div>
            )}

            {listeningState === 'processing' && (
              <div className="flex items-center gap-3 text-blue-600">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>処理中...</span>
              </div>
            )}

            {/* Control Buttons */}
            <div className="flex gap-4">
              {listeningState === 'idle' || listeningState === 'error' ? (
                <button
                  onClick={startListening}
                  disabled={!selectedSpeaker}
                  className={`flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium text-lg transition-all ${
                    selectedSpeaker
                      ? 'bg-green-500 hover:bg-green-600'
                      : 'bg-gray-300 cursor-not-allowed'
                  }`}
                >
                  <Mic className="h-6 w-6" />
                  監視開始
                </button>
              ) : listeningState !== 'processing' ? (
                <button
                  onClick={stopListening}
                  className="flex items-center gap-2 px-8 py-4 rounded-full bg-gray-800 hover:bg-gray-900 text-white font-medium text-lg transition-all"
                >
                  <MicOff className="h-6 w-6" />
                  監視停止
                </button>
              ) : null}
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
            <li>「監視開始」をクリック</li>
            <li>話し始めると自動で録音開始</li>
            <li>
              無音が{Math.round(vad.silenceDurationMs / 100) / 10}秒続くか、
              最大{Math.round(vad.maxRecordingDurationMs / 1000)}秒で自動送信
            </li>
            <li>クロノロジーに自動登録されます</li>
          </ol>
          <p className="mt-3 text-blue-600">
            ※ 監視中は連続で会話を検知・処理します
          </p>
        </div>
      </div>
    </div>
  );
}

function VadSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  suffix?: string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const display = `${value}${suffix ?? ' dB'}`;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700">{label}</div>
        <div className="text-xs font-mono text-gray-600">{display}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
      {hint && <div className="mt-1 text-[11px] text-gray-500">{hint}</div>}
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
