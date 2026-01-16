 'use client';

import Link from 'next/link';
import { ArrowLeft, RefreshCw, Users, ClipboardList, MessageCircle, PlugZap, Mic } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@/lib/api';
import { sessionsApi, zoomApi } from '@/lib/api';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/FormField';
import { Modal } from '@/components/ui/Modal';

interface ChronologyHeaderProps {
  session: Session | undefined;
  sessionId: string;
  autoScroll: boolean;
  onAutoScrollChange: (enabled: boolean) => void;
  onRefresh: () => void;
}

export function ChronologyHeader({
  session,
  sessionId,
  autoScroll,
  onAutoScrollChange,
  onRefresh,
}: ChronologyHeaderProps) {
  const [openModal, setOpenModal] = useState<null | 'summary' | 'consult'>(null);
  const [isZoomModalOpen, setIsZoomModalOpen] = useState(false);
  const [meetingId, setMeetingId] = useState('');
  const [zoomError, setZoomError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const closeModal = useCallback(() => setOpenModal(null), []);
  const openZoomModal = useCallback(() => setIsZoomModalOpen(true), []);
  const closeZoomModal = useCallback(() => {
    setIsZoomModalOpen(false);
    setZoomError(null);
  }, []);

  useEffect(() => {
    setMeetingId(session?.zoom_meeting_id ?? '');
  }, [session?.zoom_meeting_id]);

  const saveZoomIdMutation = useMutation({
    mutationFn: (value: string) =>
      sessionsApi.update(sessionId, { zoom_meeting_id: value ? value : null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });

  const joinZoomMutation = useMutation({
    mutationFn: (value: string) => zoomApi.join(sessionId, value),
  });

  const leaveZoomMutation = useMutation({
    mutationFn: () => zoomApi.leave(sessionId),
  });

  const handleConnectZoom = useCallback(async () => {
    setZoomError(null);
    const trimmed = meetingId.trim();
    if (!trimmed) {
      setZoomError('ZoomミーティングIDを入力してください');
      return;
    }
    try {
      await saveZoomIdMutation.mutateAsync(trimmed);
      await joinZoomMutation.mutateAsync(trimmed);
      closeZoomModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Zoom接続に失敗しました';
      setZoomError(msg);
    }
  }, [meetingId, saveZoomIdMutation, joinZoomMutation, closeZoomModal]);

  const handleDisconnectZoom = useCallback(async () => {
    setZoomError(null);
    try {
      await leaveZoomMutation.mutateAsync();
      closeZoomModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Zoom切断に失敗しました';
      setZoomError(msg);
    }
  }, [leaveZoomMutation, closeZoomModal]);

  return (
    <div className="bg-white border-b border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            セッション一覧
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                クロノロジー
              </span>
              {session?.status === 'running' && <LiveIndicator />}
            </div>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900 leading-tight">
              {session?.title ?? '（セッション名）'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={PlugZap}
            onClick={openZoomModal}
          >
            Zoom接続
          </Button>
          <Link
            href={`/sessions/${sessionId}/record`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Mic className="h-4 w-4" />
            音声入力
          </Link>
          <Link
            href={`/sessions/${sessionId}/participants`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Users className="h-4 w-4" />
            Zoom参加者
          </Link>
          <Button
            variant="secondary"
            size="sm"
            icon={ClipboardList}
            onClick={() => setOpenModal('summary')}
          >
            現状のまとめ
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={MessageCircle}
            onClick={() => setOpenModal('consult')}
          >
            AIと相談
          </Button>
          <Checkbox
            label="自動スクロール"
            checked={autoScroll}
            onChange={(e) => onAutoScrollChange(e.target.checked)}
          />
          <IconButton
            icon={RefreshCw}
            variant="ghost"
            label="更新"
            onClick={onRefresh}
          />
        </div>
      </div>

      <ComingSoonModal
        kind={openModal}
        onClose={closeModal}
      />

      <Modal isOpen={isZoomModalOpen} onClose={closeZoomModal} title="Zoom接続（Bot参加）">
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            このセッション（部署）に対して、指定したZoomミーティングIDへBotを参加させます。
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="zoom-meeting-id">
              ZoomミーティングID
            </label>
            <input
              id="zoom-meeting-id"
              value={meetingId}
              onChange={(e) => setMeetingId(e.target.value)}
              placeholder="例：123456789"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {zoomError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {zoomError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={closeZoomModal}>
              閉じる
            </Button>
            <Button
              variant="secondary"
              onClick={handleDisconnectZoom}
              isLoading={leaveZoomMutation.isPending}
            >
              切断
            </Button>
            <Button
              onClick={handleConnectZoom}
              isLoading={saveZoomIdMutation.isPending || joinZoomMutation.isPending}
            >
              保存して接続
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse-dot" />
      リアルタイム更新中
    </span>
  );
}

function ComingSoonModal({
  kind,
  onClose,
}: {
  kind: null | 'summary' | 'consult';
  onClose: () => void;
}) {
  if (!kind) return null;

  const title = kind === 'summary' ? '現状のまとめ（準備中）' : 'AIと相談（準備中）';
  const body =
    kind === 'summary'
      ? 'クロノロジー全体から現状を要約する機能は、次フェーズで実装予定です。'
      : 'AIに状況を相談し、次のアクション案を得る機能は、次フェーズで実装予定です。';

  return (
    <Modal isOpen={true} onClose={onClose} title={title}>
      <div className="text-sm text-gray-700 space-y-2">
        <p>{body}</p>
        <p className="text-gray-500">
          いまは導線だけ先に用意しています（UI/要件固まったらここに実装を差し込みます）。
        </p>
      </div>
      <div className="mt-6 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </Modal>
  );
}
