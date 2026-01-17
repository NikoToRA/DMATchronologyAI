'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { LogIn, AlertCircle, Radio, Building2 } from 'lucide-react';
import { incidentsApi, api, Incident, Participant } from '@/lib/api';
import { useUserSession } from '@/contexts/UserSessionContext';

export default function UserLoginPage() {
  const router = useRouter();
  const { session, isLoggedIn, login } = useUserSession();

  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [speakerName, setSpeakerName] = useState<string>('');
  const [error, setError] = useState<string>('');

  // If already logged in, redirect to incident page
  useEffect(() => {
    if (isLoggedIn && session) {
      router.push(`/user/incident/${session.incidentId}`);
    }
  }, [isLoggedIn, session, router]);

  // Fetch active incidents
  const { data: incidents, isLoading: isLoadingIncidents } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => incidentsApi.list().then((res) => res.data),
  });

  // Filter to only active incidents
  const activeIncidents = incidents?.filter((inc) => inc.status === 'active') ?? [];

  // Register speaker mutation
  const registerSpeakerMutation = useMutation({
    mutationFn: async ({
      incidentId,
      speakerName,
    }: {
      incidentId: string;
      speakerName: string;
    }) => {
      // Get incident to find the first session for registration
      const incident = await incidentsApi.get(incidentId).then((res) => res.data);

      // Use activity_command session for speaker registration (or first available)
      const sessionId =
        incident.sessions.activity_command ||
        incident.sessions.transport_coordination ||
        incident.sessions.info_analysis ||
        incident.sessions.logistics_support ||
        (incident.extra_sessions?.[0]?.session_id ?? '');

      if (!sessionId) {
        throw new Error('この災害ボックスにはセッションがありません');
      }

      // Register as participant
      const response = await api.post<Participant>(
        `/api/sessions/${sessionId}/participants`,
        { zoom_display_name: speakerName }
      );

      return {
        incident,
        participant: response.data,
      };
    },
    onSuccess: ({ incident, participant }) => {
      login({
        incidentId: incident.incident_id,
        incidentName: incident.incident_name,
        speakerName: speakerName,
        speakerId: participant.participant_id,
      });
      router.push(`/user/incident/${incident.incident_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || '入室に失敗しました');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedIncidentId) {
      setError('災害ボックスを選択してください');
      return;
    }
    if (!speakerName.trim()) {
      setError('本部名を入力してください');
      return;
    }

    registerSpeakerMutation.mutate({
      incidentId: selectedIncidentId,
      speakerName: speakerName.trim(),
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Radio className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              ChronologyAI
            </h1>
            <p className="text-gray-500 mt-2">
              災害対応クロノロジーシステム
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Incident Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                災害ボックスを選択
              </label>
              {isLoadingIncidents ? (
                <div className="text-gray-500 text-sm py-4 text-center">
                  読み込み中...
                </div>
              ) : activeIncidents.length === 0 ? (
                <div className="text-gray-500 text-sm py-4 text-center bg-gray-50 rounded-lg">
                  アクティブな災害ボックスがありません
                </div>
              ) : (
                <div className="space-y-2">
                  {activeIncidents.map((incident) => (
                    <label
                      key={incident.incident_id}
                      className={`flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedIncidentId === incident.incident_id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="incident"
                        value={incident.incident_id}
                        checked={selectedIncidentId === incident.incident_id}
                        onChange={(e) => setSelectedIncidentId(e.target.value)}
                        className="sr-only"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {incident.incident_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {incident.incident_date}〜
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedIncidentId === incident.incident_id
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedIncidentId === incident.incident_id && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Speaker Name Input */}
            <div>
              <label
                htmlFor="speakerName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                <Building2 className="inline h-4 w-4 mr-1" />
                本部名を入力
              </label>
              <input
                type="text"
                id="speakerName"
                value={speakerName}
                onChange={(e) => setSpeakerName(e.target.value)}
                placeholder="例：北海道調整本部"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <p className="mt-2 text-xs text-gray-500">
                入室後は本部名を変更できません
              </p>
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
              disabled={
                registerSpeakerMutation.isPending ||
                !selectedIncidentId ||
                !speakerName.trim()
              }
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all"
            >
              {registerSpeakerMutation.isPending ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  入室中...
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  入室する
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-400">
              管理者の方は
              <a href="/" className="text-blue-600 hover:underline ml-1">
                管理画面へ
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
