 'use client';

import Link from 'next/link';
import { RefreshCw, ClipboardList, MessageCircle, Mic } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { Session } from '@/lib/api';
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

  const closeModal = useCallback(() => setOpenModal(null), []);

  return (
    <div className="bg-white border-b border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
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
          <Link
            href={`/sessions/${sessionId}/record`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Mic className="h-4 w-4" />
            音声入力
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
