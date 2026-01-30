'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Building2, Trash2, Plus } from 'lucide-react';
import { chronologyApi, participantsApi, sessionsApi, incidentsApi, sessionHqApi, type Incident, type Session, type HQMaster } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { LoadingPlaceholder, EmptyState } from '@/components/ui/LoadingState';
import { useRouter, useSearchParams } from 'next/navigation';

export default function SessionsPage() {
  const [isCreatingDemo, setIsCreatingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const selectedIncidentId = searchParams.get('incident');

  const { data: incidents, isLoading: isIncidentsLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => incidentsApi.list().then((r) => r.data),
  });

  useEffect(() => {
    if (selectedIncidentId) return;
    if (!incidents || incidents.length === 0) return;
    const active = incidents.find((i) => i.status === 'active');
    const fallback = active ?? incidents[0];
    router.replace(`/admin?incident=${fallback.incident_id}`);
  }, [incidents, selectedIncidentId]);

  const selectedIncident: Incident | undefined = useMemo(() => {
    if (!incidents || !selectedIncidentId) return undefined;
    return incidents.find((i) => i.incident_id === selectedIncidentId);
  }, [incidents, selectedIncidentId]);

  const { data: allSessions, isLoading: isSessionsLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => sessionsApi.list().then((r) => r.data),
  });

  const sessionsInIncident = useMemo(() => {
    if (!selectedIncident || !allSessions) return [];
    const ids = new Set<string>();
    Object.values(selectedIncident.sessions ?? {}).forEach((id) => ids.add(id));
    (selectedIncident?.extra_sessions ?? []).forEach((x) => {
      if (x?.session_id) ids.add(x.session_id);
    });
    return allSessions.filter((s) => ids.has(s.session_id));
  }, [allSessions, selectedIncident]);

  const handleCreateDemo = useCallback(async () => {
    if (isCreatingDemo) return;

    setIsCreatingDemo(true);
    setDemoError(null);

    try {
      // 1) Create demo incident (auto-creates 4 sessions)
      const incidentRes = await incidentsApi.create({
        incident_name: '能登半島地震（デモ）',
        incident_date: new Date().toISOString().slice(0, 10),
      });
      const incidentId = incidentRes.data.incident_id;
      const sessionId = incidentRes.data.sessions?.activity_command;
      if (!sessionId) throw new Error('demo incident session missing');

      // 2) Add demo participants (best-effort)
      const participants = await Promise.allSettled([
        participantsApi.create(sessionId, { zoom_display_name: '札幌中央活動拠点本部' }),
        participantsApi.create(sessionId, { zoom_display_name: '札幌南活動拠点本部' }),
        participantsApi.create(sessionId, { zoom_display_name: '札幌徳洲会病院支援指揮所' }),
        participantsApi.create(sessionId, { zoom_display_name: '札幌東徳洲会病院支援指揮所' }),
      ]);
      const fulfilledParticipant = participants.find(
        (p): p is PromiseFulfilledResult<Awaited<ReturnType<typeof participantsApi.create>>> =>
          p.status === 'fulfilled'
      );
      const participantId = fulfilledParticipant?.value.data.participant_id ?? undefined;

      // 3) Create a few demo chronology entries (best-effort; may fail if AI not configured)
      await Promise.allSettled([
        chronologyApi.create(sessionId, {
          text_raw: '状況報告：避難所Aで負傷者多数。トリアージを開始します。',
          participant_id: participantId,
        }),
        chronologyApi.create(sessionId, {
          text_raw: '依頼：搬送ルートを確保してください。道路の通行止め情報が必要です。',
          participant_id: participantId,
        }),
        chronologyApi.create(sessionId, {
          text_raw: '決定：医療班を避難所Aへ優先派遣。救護所の設置を進めます。',
          participant_id: participantId,
        }),
      ]);

      // 4) Ensure there is at least one "発信者未確定" entry for demo.
      // We do this by clearing HQ assignment on the latest entry (so it doesn't depend on AI/classifier behavior).
      const createdEntries = await chronologyApi.list(sessionId).then((r) => r.data);
      if (createdEntries.length > 0) {
        const last = createdEntries[createdEntries.length - 1];
        await chronologyApi.update(sessionId, last.entry_id, {
          hq_id: null,
          is_hq_confirmed: false,
        });
      }

      // 5) Navigate to the demo session chronology page
      router.push(`/sessions/${sessionId}/chronology`);
    } catch (e) {
      setDemoError('デモ作成に失敗しました。バックエンドが起動しているか確認してください。');
    } finally {
      setIsCreatingDemo(false);
    }
  }, [isCreatingDemo, router]);

  const updateIncidentStatusMutation = useMutation({
    mutationFn: (status: 'active' | 'ended') =>
      incidentsApi.update(selectedIncidentId as string, { status }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['incidents'] }),
  });

  const ensureDepartmentsMutation = useMutation({
    mutationFn: () => incidentsApi.ensureDepartmentSessions(selectedIncidentId as string).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const createExtraSessionMutation = useMutation({
    mutationFn: (data: { label: string; zoom_meeting_id?: string }) =>
      incidentsApi.addExtraSession(selectedIncidentId as string, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error: Error) => {
      console.error('単発セッション作成エラー:', error);
      alert(`単発セッションの作成に失敗しました: ${error.message}`);
    },
  });

  const deleteIncidentMutation = useMutation({
    mutationFn: (incidentId: string) => incidentsApi.delete(incidentId).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      router.replace('/admin');
    },
  });

  const departmentSessions = useMemo(() => {
    const ORDER = ['activity_command', 'command_coordination', 'transport_coordination', 'info_analysis', 'logistics_support'];
    return (sessionsInIncident ?? [])
      .filter((s) => s.session_kind !== 'extra')
      .sort((a, b) => {
        const aIndex = ORDER.indexOf(a.session_kind || '');
        const bIndex = ORDER.indexOf(b.session_kind || '');
        return aIndex - bIndex;
      });
  }, [sessionsInIncident]);

  const extraSessions = useMemo(() => {
    return (sessionsInIncident ?? []).filter((s) => s.session_kind === 'extra');
  }, [sessionsInIncident]);

  const missingDepartmentKinds = useMemo(() => {
    if (!selectedIncident) return [];
    const required = ['activity_command', 'command_coordination', 'transport_coordination', 'info_analysis', 'logistics_support'] as const;
    return required.filter((k) => !selectedIncident.sessions?.[k]);
  }, [selectedIncident]);

  // Get primary session ID for HQ management
  const primarySessionId = useMemo(() => {
    if (!selectedIncident) return null;
    return (
      selectedIncident.sessions.activity_command ||
      selectedIncident.sessions.transport_coordination ||
      selectedIncident.sessions.info_analysis ||
      selectedIncident.sessions.logistics_support ||
      null
    );
  }, [selectedIncident]);

  // Fetch HQ list for the incident
  const { data: hqList, isLoading: isHqLoading } = useQuery({
    queryKey: ['session-hq', primarySessionId],
    queryFn: () => sessionHqApi.list(primarySessionId!).then((r) => r.data),
    enabled: !!primarySessionId,
  });

  // HQ mutations
  const createHqMutation = useMutation({
    mutationFn: (data: { hq_name: string; zoom_pattern: string }) => {
      console.log('Creating HQ with sessionId:', primarySessionId, 'data:', data);
      return sessionHqApi.create(primarySessionId!, data).then((r) => r.data);
    },
    onSuccess: (data) => {
      console.log('HQ created successfully:', data);
      queryClient.invalidateQueries({ queryKey: ['session-hq', primarySessionId] });
    },
    onError: (error: Error) => {
      console.error('HQ creation error:', error);
      alert(`本部の追加に失敗しました: ${error.message}`);
    },
  });

  const deleteHqMutation = useMutation({
    mutationFn: (hqId: string) => sessionHqApi.delete(primarySessionId!, hqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-hq', primarySessionId] });
    },
    onError: (error: Error) => {
      alert(`本部の削除に失敗しました: ${error.message}`);
    },
  });

  const toggleHqActiveMutation = useMutation({
    mutationFn: ({ hqId, active }: { hqId: string; active: boolean }) =>
      sessionHqApi.update(primarySessionId!, hqId, { active }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-hq', primarySessionId] });
    },
  });

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">セッション一覧</h1>
          <p className="text-sm text-gray-500">左のサイドバーから災害ボックスを選択してください</p>
        </div>
        <Button variant="secondary" onClick={handleCreateDemo} disabled={isCreatingDemo}>
          {isCreatingDemo ? 'デモ作成中...' : 'デモを作成'}
        </Button>
      </div>

      {demoError && (
        <div className="mb-3 rounded-lg bg-red-50 text-red-700 px-4 py-2 text-sm">
          {demoError}
        </div>
      )}

      {isIncidentsLoading ? (
        <div className="bg-white rounded-lg shadow p-4">
          <LoadingPlaceholder />
        </div>
      ) : !incidents || incidents.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6">
          <EmptyState icon={<Clock className="h-10 w-10 text-gray-300" />} title="災害ボックスがありません" />
        </div>
      ) : !selectedIncident ? (
        <div className="bg-white rounded-lg shadow p-8">
          <EmptyState title="左の災害ボックスを選んでください" />
        </div>
      ) : (
        <div className="space-y-4">
          {missingDepartmentKinds.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
              <div className="font-semibold">4部署セッションが未作成です</div>
              <div className="mt-1 text-yellow-800">
                不足分（{missingDepartmentKinds.length}件）を自動作成します。
              </div>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={() => ensureDepartmentsMutation.mutate()}
                  disabled={ensureDepartmentsMutation.isPending}
                >
                  {ensureDepartmentsMutation.isPending ? '作成中...' : '4部署を作成'}
                </Button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg shadow p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-gray-500">選択中の災害ボックス</div>
              <div className="text-2xl font-bold text-gray-900 truncate">{selectedIncident.incident_name}</div>
              <div className="text-sm text-gray-500 mt-1">
                発災日: {selectedIncident.incident_date.replaceAll('-', '/')}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="secondary"
                onClick={() =>
                  updateIncidentStatusMutation.mutate(selectedIncident.status === 'active' ? 'ended' : 'active')
                }
                disabled={updateIncidentStatusMutation.isPending}
              >
                {updateIncidentStatusMutation.isPending
                  ? '更新中...'
                  : selectedIncident.status === 'active'
                    ? '終了へ移動'
                    : '対応中へ戻す'}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(`「${selectedIncident.incident_name}」を削除しますか？`)) {
                    deleteIncidentMutation.mutate(selectedIncident.incident_id);
                  }
                }}
                disabled={deleteIncidentMutation.isPending}
              >
                {deleteIncidentMutation.isPending ? '削除中...' : '削除'}
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-gray-500">ボックス内セッション</div>
                <div className="text-lg font-semibold text-gray-900">4部署 + 追加Zoom（Extra）</div>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  const roomName = window.prompt('追加するセッション名（例：医療連携、広報、現地連絡）');
                  if (!roomName || !roomName.trim()) return;
                  createExtraSessionMutation.mutate({
                    label: roomName.trim(),
                  });
                }}
                disabled={createExtraSessionMutation.isPending}
              >
                {createExtraSessionMutation.isPending ? '追加中...' : '＋追加Zoom'}
              </Button>
            </div>

            {isSessionsLoading ? (
              <LoadingPlaceholder />
            ) : (
              <IncidentSessionsPanel
                departmentSessions={departmentSessions}
                extraSessions={extraSessions}
              />
            )}
          </div>

          {/* 本部管理セクション */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-gray-500">本部管理</div>
                <div className="text-lg font-semibold text-gray-900">ユーザーが選択できる本部一覧</div>
              </div>
              <Button
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  const hqName = window.prompt('本部名を入力（例：北海道調整本部、札幌DMAT）');
                  if (!hqName || !hqName.trim()) return;
                  createHqMutation.mutate({
                    hq_name: hqName.trim(),
                    zoom_pattern: hqName.trim(),
                  });
                }}
                disabled={createHqMutation.isPending || !primarySessionId}
              >
                {createHqMutation.isPending ? '追加中...' : '本部を追加'}
              </Button>
            </div>

            {!primarySessionId ? (
              <div className="text-sm text-gray-500">セッションがありません。先に4部署を作成してください。</div>
            ) : isHqLoading ? (
              <LoadingPlaceholder />
            ) : !hqList || hqList.length === 0 ? (
              <div className="text-sm text-gray-500 py-4 text-center bg-gray-50 rounded-lg">
                登録された本部がありません
              </div>
            ) : (
              <div className="space-y-2">
                {hqList.map((hq) => (
                  <div
                    key={hq.hq_id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${hq.active ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-gray-100 opacity-60'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <Building2 className="h-5 w-5 text-gray-500" />
                      <div>
                        <div className="font-medium text-gray-900">{hq.hq_name}</div>
                        {!hq.active && <div className="text-xs text-gray-500">無効</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleHqActiveMutation.mutate({ hqId: hq.hq_id, active: !hq.active })}
                        className={`px-3 py-1 text-sm rounded ${hq.active
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}
                      >
                        {hq.active ? '無効化' : '有効化'}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`「${hq.hq_name}」を削除しますか？`)) {
                            deleteHqMutation.mutate(hq.hq_id);
                          }
                        }}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getSessionKindLabel(kind?: string): string {
  const labels: Record<string, string> = {
    activity_command: '活動指揮',
    command_coordination: '統括・調整班',
    transport_coordination: '搬送調整班',
    info_analysis: '情報分析班',
    logistics_support: '物資支援班',
    extra: '追加',
  };
  return labels[kind ?? ''] ?? kind ?? '';
}

function IncidentSessionsPanel({
  departmentSessions,
  extraSessions,
}: {
  departmentSessions: Session[];
  extraSessions: Session[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">部署セッション</div>
        {departmentSessions.length === 0 ? (
          <div className="text-sm text-gray-500">なし</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {departmentSessions.map((s) => (
              <div key={s.session_id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm text-gray-500">{getSessionKindLabel(s.session_kind)}</div>
                <div className="text-lg font-semibold text-gray-900 mt-0.5">{s.title}</div>
                <div className="mt-3 flex items-center gap-2">
                  <Button onClick={() => router.push(`/sessions/${s.session_id}/chronology`)}>クロノロジー</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">追加Zoom（Extra）</div>
        {extraSessions.length === 0 ? (
          <div className="text-sm text-gray-500">追加ルームはまだありません</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {extraSessions.map((s) => (
              <div key={s.session_id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm text-gray-500">{getSessionKindLabel(s.session_kind)}</div>
                <div className="text-lg font-semibold text-gray-900 mt-0.5">{s.title}</div>
                <div className="mt-3 flex items-center gap-2">
                  <Button onClick={() => router.push(`/sessions/${s.session_id}/chronology`)}>クロノロジー</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
