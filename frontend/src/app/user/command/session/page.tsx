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
    Activity,
    MessageSquare,
    Send,
    Keyboard,
} from 'lucide-react';
import { AIChatPanel } from '@/components/chat';
import { useChronology, useChronologyAutoScroll } from '@/hooks';
import {
    ChronologyEntryList,
    ChronologyFilters,
} from '@/components/chronology';
import type { ChronologyCategory } from '@/lib/api';
import {
    addToQueue,
    uploadSegment,
} from '@/lib/audioQueue';
import { api, Participant, chronologyApi } from '@/lib/api';

// =============================================================================
// Types
// =============================================================================

type RecordingState = 'idle' | 'recording' | 'sending';

interface CommandSession {
    sessionId: string;
    speakerName: string;
    speakerId: string;
    hqId: string;
    incidentName: string;
}

// =============================================================================
// Main Component
// =============================================================================

export default function CommandSessionPage() {
    const router = useRouter();
    const queryClient = useQueryClient();

    // Load session from localStorage
    const [commandSession, setCommandSession] = useState<CommandSession | null>(null);
    const [isRegistering, setIsRegistering] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('command_session');
        if (stored) {
            setCommandSession(JSON.parse(stored));
        } else {
            router.push('/user/command');
        }
    }, [router]);

    const sessionId = commandSession?.sessionId || '';

    // State
    const [recordingState, setRecordingState] = useState<RecordingState>('idle');
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [isOnline, setIsOnline] = useState(true);
    const [sendingCount, setSendingCount] = useState(0); // 送信中の件数
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [sendingPhase, setSendingPhase] = useState<'stt' | 'ai' | null>(null);
    const sendingPhaseTimeoutRef = useRef<number | null>(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [isTextSending, setIsTextSending] = useState(false);
    const [showTextInput, setShowTextInput] = useState(false);

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const recordingStartRef = useRef<number | null>(null);
    const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Chronology data using shared hook
    const {
        entries,
        participants,
        hqMaster,
        isEntriesLoading,
        updateEntry,
        refetch,
        stats,
        filters,
        setFilters,
    } = useChronology(sessionId);

    // Filter handlers
    const handleCategoryChange = useCallback(
        (category: ChronologyCategory | '') => {
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

    const { scrollRef } = useChronologyAutoScroll(entries);

    // Delete entry handler
    const handleDeleteEntry = useCallback(
        async (entryId: string) => {
            try {
                await chronologyApi.delete(sessionId, entryId);
                queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
            } catch (err: any) {
                console.error('Failed to delete entry:', err);
                setErrorMessage('削除に失敗しました');
            }
        },
        [sessionId, queryClient]
    );

    // Register participant in this session if not already registered
    useEffect(() => {
        if (!commandSession || !sessionId || !participants) return;
        if (isRegistering) return;

        const existingParticipant = participants.find(
            (p) => p.participant_id === commandSession.speakerId
        );

        if (!existingParticipant) {
            setIsRegistering(true);
            api
                .post<Participant>(`/api/sessions/${sessionId}/participants`, {
                    zoom_display_name: commandSession.speakerName,
                    hq_id: commandSession.hqId,
                })
                .then((response) => {
                    const newParticipant = response.data;
                    const updated = { ...commandSession, speakerId: newParticipant.participant_id };
                    setCommandSession(updated);
                    localStorage.setItem('command_session', JSON.stringify(updated));
                    queryClient.invalidateQueries({ queryKey: ['participants', sessionId] });
                })
                .catch((err) => {
                    console.error('Failed to register participant:', err);
                })
                .finally(() => {
                    setIsRegistering(false);
                });
        }
    }, [commandSession, sessionId, participants, isRegistering, queryClient]);

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

    // Sending progress UX (approximate): STT -> AI
    useEffect(() => {
        // Clear any previous timer
        if (sendingPhaseTimeoutRef.current) {
            window.clearTimeout(sendingPhaseTimeoutRef.current);
            sendingPhaseTimeoutRef.current = null;
        }

        if (sendingCount <= 0) {
            setSendingPhase(null);
            return;
        }

        // Immediately show "speech recognition" phase, then transition to "AI analysis"
        setSendingPhase('stt');
        sendingPhaseTimeoutRef.current = window.setTimeout(() => {
            setSendingPhase('ai');
            sendingPhaseTimeoutRef.current = null;
        }, 1200);

        return () => {
            if (sendingPhaseTimeoutRef.current) {
                window.clearTimeout(sendingPhaseTimeoutRef.current);
                sendingPhaseTimeoutRef.current = null;
            }
        };
    }, [sendingCount]);

    // ==========================================================================
    // Recording Functions
    // ==========================================================================

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
        setRecordingDuration(0);
    }, []);

    // Keep analyser active while recording (for browser audio graph stability)
    const updateAudioLevel = useCallback(() => {
        if (!analyserRef.current) return;
        if (recordingState !== 'recording') return;
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }, [recordingState]);

    const uploadWithRetry = useCallback(
        async (segment: any) => {
            const maxRetries = 10;
            const retryDelay = 3000;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                while (!navigator.onLine) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }

                try {
                    const result = await uploadSegment(segment);
                    if (result.ok) {
                        queryClient.invalidateQueries({ queryKey: ['chronology', sessionId] });
                        return true;
                    }
                    // show backend stage/error in UI (helps debug)
                    setErrorMessage(result.error || '音声の処理に失敗しました');
                } catch (err: any) {
                    setErrorMessage(err?.message || '音声の送信に失敗しました');
                }

                if (attempt < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelay));
                }
            }
            return false;
        },
        [queryClient, sessionId]
    );

    const processRecording = useCallback(
        async (recordedMimeType: string | undefined) => {
            if (audioChunksRef.current.length === 0) {
                setRecordingState('idle');
                cleanupRecordingResources();
                return;
            }

            const duration = recordingStartRef.current
                ? (Date.now() - recordingStartRef.current) / 1000
                : 0;

            // too short -> discard
            if (duration < 0.5) {
                setRecordingState('idle');
                cleanupRecordingResources();
                return;
            }

            const startTime = recordingStartRef.current
                ? new Date(recordingStartRef.current).toISOString()
                : new Date().toISOString();
            const endTime = new Date().toISOString();

            setRecordingState('sending');
            setSendingCount((prev) => prev + 1);

            const mime = recordedMimeType || 'audio/webm';
            const audioBlob = new Blob(audioChunksRef.current, { type: mime });
            audioChunksRef.current = [];

            try {
                const segment = await addToQueue({
                    sessionId,
                    speakerName: commandSession?.speakerName || '',
                    speakerId: commandSession?.speakerId || '',
                    audioBlob,
                    startTime,
                    endTime,
                    duration,
                });

                // allow next recording immediately
                setRecordingState('idle');

                // upload in background
                uploadWithRetry(segment).finally(() => {
                    setSendingCount((prev) => Math.max(0, prev - 1));
                });
            } catch (err: any) {
                console.error('Failed to process recording:', err);
                setErrorMessage(err?.message || '録音の処理に失敗しました');
                setRecordingState('idle');
                setSendingCount((prev) => Math.max(0, prev - 1));
            } finally {
                cleanupRecordingResources();
            }
        },
        [commandSession?.speakerId, commandSession?.speakerName, cleanupRecordingResources, sessionId, uploadWithRetry]
    );

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
                    setRecordingDuration(
                        Math.floor((Date.now() - recordingStartRef.current) / 1000)
                    );
                }
            }, 100);
        } catch (err) {
            console.error('Failed to start recording:', err);
            setErrorMessage('マイクへのアクセスに失敗しました');
            setRecordingState('idle');
            cleanupRecordingResources();
        }
    }, [cleanupRecordingResources, processRecording, recordingState, updateAudioLevel]);

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
    }, [recordingState]);
    // Stop mic if user leaves / reloads while recording.
    useEffect(() => {
        const handleVisibility = () => {
            if (document.hidden && recordingState === 'recording') {
                try {
                    stopRecording();
                } catch {
                    cleanupRecordingResources();
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [cleanupRecordingResources, recordingState, stopRecording]);

    // Logout handler
    const handleLogout = useCallback(() => {
        localStorage.removeItem('command_session');
        router.push('/user/command');
    }, [router]);

    // Text input submit handler
    const handleTextSubmit = useCallback(async () => {
        if (!textInput.trim() || !commandSession || isTextSending) return;

        setIsTextSending(true);
        setErrorMessage('');

        try {
            await chronologyApi.create(sessionId, {
                text_raw: textInput.trim(),
                participant_id: commandSession.speakerId,
                timestamp: new Date().toISOString(),
            });
            setTextInput('');
            // 即座にデータを再取得
            await refetch();
        } catch (err: any) {
            console.error('Failed to submit text:', err);
            setErrorMessage(err?.message || 'テキスト送信に失敗しました');
        } finally {
            setIsTextSending(false);
        }
    }, [textInput, commandSession, sessionId, isTextSending, refetch]);

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
            cleanupRecordingResources();
        };
    }, [cleanupRecordingResources]);

    // ==========================================================================
    // Render
    // ==========================================================================

    if (!commandSession) {
        return null;
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="min-h-screen bg-blue-50 flex flex-col">
            {/* Header */}
            <header className="bg-blue-600 text-white sticky top-0 z-20">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Activity className="h-6 w-6" />
                            <div>
                                <h1 className="font-bold text-lg">統括・調整班</h1>
                                <p className="text-xs text-blue-100">
                                    2026年DMAT関東ブロック訓練
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 bg-blue-700 px-3 py-1.5 rounded-lg">
                                <Building2 className="h-4 w-4" />
                                <span className="text-sm font-medium">
                                    {commandSession.speakerName}
                                </span>
                            </div>
                            <div
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${isOnline ? 'bg-green-500' : 'bg-red-500'
                                    }`}
                            >
                                {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                            </div>
                            <button
                                onClick={() => setIsChatOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-yellow-500 hover:bg-yellow-600 transition-colors"
                                title="AIチャット"
                            >
                                <MessageSquare className="h-4 w-4" />
                                <span className="hidden sm:inline">AI相談</span>
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-blue-700 hover:bg-blue-800 transition-colors"
                                title="ログアウト"
                            >
                                <LogOut className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* フィルター */}
            <div className="sticky top-[60px] z-10 bg-white">
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

            {/* Chronology List - フルスクリーン */}
            <main className="flex-1 max-w-4xl mx-auto w-full pb-24">
                <ChronologyEntryList
                    entries={entries}
                    isLoading={isEntriesLoading}
                    scrollRef={scrollRef}
                    onUpdateEntry={updateEntry}
                    onDeleteEntry={handleDeleteEntry}
                    participants={participants}
                    sessionId={sessionId}
                />
            </main>

            {/* フローティング録音ボタン - 右下固定 */}
            <div className="fixed bottom-12 right-4 z-30 flex flex-col items-end gap-2">
                {/* エラーメッセージ */}
                {errorMessage && (
                    <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-56 text-right shadow-lg">
                        {errorMessage}
                    </div>
                )}

                {/* 送信中インジケーター */}
                {sendingCount > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 bg-white rounded-lg px-3 py-2 shadow-lg border">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>
                            {sendingPhase === 'ai' ? 'AI解析中' : '音声認識中'}
                        </span>
                    </div>
                )}

                {/* 録音ボタン - 特大サイズ */}
                <button
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    disabled={recordingState === 'sending'}
                    className={`px-16 py-10 rounded-3xl font-bold text-3xl shadow-2xl transition-all ${recordingState === 'recording'
                            ? 'bg-red-500 text-white scale-105'
                            : recordingState === 'sending'
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-500 text-white hover:bg-blue-600 active:bg-red-500'
                        }`}
                >
                    {recordingState === 'recording' ? (
                        <span className="flex items-center gap-5">
                            <span className="w-7 h-7 bg-white rounded-full animate-pulse" />
                            {formatDuration(recordingDuration)}
                        </span>
                    ) : recordingState === 'sending' ? (
                        <Loader2 className="h-14 w-14 animate-spin" />
                    ) : (
                        <span className="flex items-center gap-5">
                            <Mic className="h-14 w-14" />
                            <span>発話</span>
                            <span className="text-xl opacity-75">(Space)</span>
                        </span>
                    )}
                </button>
            </div>

            {/* フローティングテキスト入力欄 */}
            {showTextInput && (
                <div className="fixed bottom-14 left-0 right-0 z-25 px-4">
                    <div className="max-w-4xl mx-auto">
                        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-3">
                            <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                                <Building2 className="h-3 w-3" />
                                <span>{commandSession?.speakerName}</span>
                                <span className="ml-auto">{new Date().toLocaleTimeString('ja-JP')}</span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleTextSubmit();
                                        }
                                    }}
                                    placeholder="テキストで記録を入力..."
                                    className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base"
                                    autoFocus
                                    disabled={isTextSending}
                                />
                                <button
                                    onClick={handleTextSubmit}
                                    disabled={!textInput.trim() || isTextSending}
                                    className="px-5 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-all flex items-center gap-2"
                                >
                                    {isTextSending ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <Send className="h-5 w-5" />
                                    )}
                                </button>
                                <button
                                    onClick={() => setShowTextInput(false)}
                                    className="px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-xl transition-all"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* キーボード入力トグルボタン */}
            {!showTextInput && (
                <button
                    onClick={() => setShowTextInput(true)}
                    className="fixed bottom-14 left-4 z-30 p-4 bg-white hover:bg-gray-100 text-gray-600 rounded-full shadow-lg border border-gray-200 transition-all"
                    title="テキスト入力"
                >
                    <Keyboard className="h-6 w-6" />
                </button>
            )}

            {/* Simple Footer */}
            <div className="bg-white border-t border-gray-200 py-2 fixed bottom-0 left-0 right-0 z-20">
                <div className="max-w-4xl mx-auto px-4 text-center text-xs text-gray-400">
                    全{stats.total}件
                </div>
            </div>

            {/* AI Chat Panel */}
            <AIChatPanel
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                sessionId={sessionId}
                hqId={commandSession.hqId}
                hqName={commandSession.speakerName}
            />
        </div>
    );
}
