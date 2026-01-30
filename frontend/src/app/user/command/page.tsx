'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, Building2 } from 'lucide-react';
import { incidentsApi, sessionHqApi, api, Participant } from '@/lib/api';

const INCIDENT_NAME = '2026年DMAT関東ブロック訓練_物資支援';

export default function CommandLoginPage() {
    const router = useRouter();
    const [selectedHqId, setSelectedHqId] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch active incidents
    const { data: incidents, isLoading: isLoadingIncidents, error: incidentsError } = useQuery({
        queryKey: ['incidents'],
        queryFn: async () => {
            const res = await incidentsApi.list();
            return res.data;
        },
    });

    // Find the target incident
    const targetIncident = incidents?.find(
        (inc) => inc.incident_name === INCIDENT_NAME && inc.status === 'active'
    );

    // Get activity_command session ID (統括・調整班用として活動指揮セッションを使用)
    const sessionId = targetIncident?.sessions?.activity_command || null;

    // Fetch HQ list for the session
    const { data: hqList, isLoading: isLoadingHq } = useQuery({
        queryKey: ['session-hq', sessionId],
        queryFn: async () => {
            const res = await sessionHqApi.list(sessionId!);
            return res.data;
        },
        enabled: !!sessionId,
    });

    // Active HQs only
    const activeHqList = (hqList ?? []).filter((hq) => hq.active);

    // Get the selected HQ
    const selectedHq = activeHqList.find((hq) => hq.hq_id === selectedHqId);

    // Handle submit
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!selectedHqId || !selectedHq || !sessionId) {
            setError('本部を選択してください');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await api.post<Participant>(
                `/api/sessions/${sessionId}/participants`,
                {
                    zoom_display_name: selectedHq.hq_name,
                    hq_id: selectedHqId,
                }
            );

            // Save session info to localStorage (key is command_session)
            const commandSession = {
                sessionId,
                speakerName: selectedHq.hq_name,
                speakerId: response.data.participant_id,
                hqId: selectedHqId,
                incidentName: INCIDENT_NAME,
            };
            localStorage.setItem('command_session', JSON.stringify(commandSession));
            router.push('/user/command/session');
        } catch (err: any) {
            setError(err.message || '入室に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Loading state
    if (isLoadingIncidents) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center">
                <div className="text-gray-500">読み込み中...</div>
            </div>
        );
    }

    // Error state
    if (incidentsError) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                        <AlertCircle className="h-8 w-8 text-red-600" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 mb-2">
                        エラーが発生しました
                    </h1>
                    <p className="text-gray-500 text-sm">
                        {String(incidentsError)}
                    </p>
                </div>
            </div>
        );
    }

    // No target incident found
    if (!targetIncident) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                        <AlertCircle className="h-8 w-8 text-red-600" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 mb-2">
                        災害が見つかりません
                    </h1>
                    <p className="text-gray-500 text-sm">
                        「{INCIDENT_NAME}」がアクティブではありません。
                        <br />
                        管理者に連絡してください。
                    </p>
                    <p className="text-xs text-gray-400 mt-4">
                        取得した災害数: {incidents?.length ?? 0}
                    </p>
                </div>
            </div>
        );
    }

    const canSubmit = selectedHqId && !isSubmitting;

    return (
        <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4">
                            <Activity className="h-10 w-10 text-blue-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            統括・調整班
                        </h1>
                        <p className="text-gray-500 mt-2 text-sm">
                            2026年DMAT関東ブロック訓練
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* HQ Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-3">
                                <Building2 className="inline h-4 w-4 mr-1" />
                                所属本部を選択
                            </label>

                            {isLoadingHq ? (
                                <div className="text-gray-500 text-sm py-4 text-center">
                                    本部リスト読み込み中...
                                </div>
                            ) : activeHqList.length === 0 ? (
                                <div className="text-gray-500 text-sm py-4 text-center bg-gray-50 rounded-lg">
                                    登録された本部がありません
                                    <br />
                                    <span className="text-xs">管理画面から本部を登録してください</span>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {activeHqList.map((hq) => (
                                        <label
                                            key={hq.hq_id}
                                            className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedHqId === hq.hq_id
                                                    ? 'border-blue-500 bg-blue-50'
                                                    : 'border-gray-200 hover:border-blue-300'
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="hq"
                                                value={hq.hq_id}
                                                checked={selectedHqId === hq.hq_id}
                                                onChange={(e) => setSelectedHqId(e.target.value)}
                                                className="sr-only"
                                            />
                                            <div className="flex-1">
                                                <div className="font-semibold text-gray-900 text-lg">
                                                    {hq.hq_name}
                                                </div>
                                            </div>
                                            <div
                                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedHqId === hq.hq_id
                                                        ? 'border-blue-500 bg-blue-500'
                                                        : 'border-gray-300'
                                                    }`}
                                            >
                                                {selectedHqId === hq.hq_id && (
                                                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                                                )}
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="w-full flex items-center justify-center gap-2 px-6 py-5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl transition-all"
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    入室中...
                                </>
                            ) : (
                                '入室する'
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
