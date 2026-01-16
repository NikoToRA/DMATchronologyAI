'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ArrowLeft, Clock, Mic, Play, Square } from 'lucide-react';
import type { Session } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface SessionHeaderProps {
  session: Session;
  onStart: () => void;
  onEnd: () => void;
  isStarting?: boolean;
  isEnding?: boolean;
}

export function SessionHeader({
  session,
  onStart,
  onEnd,
  isStarting = false,
  isEnding = false,
}: SessionHeaderProps) {
  const formattedDate = format(new Date(session.start_at), 'yyyy/MM/dd HH:mm', {
    locale: ja,
  });

  return (
    <div className="mb-6">
      <BackLink />
      <div className="flex items-start justify-between">
        <SessionInfo session={session} formattedDate={formattedDate} />
        <SessionActions
          status={session.status}
          sessionId={session.session_id}
          onStart={onStart}
          onEnd={onEnd}
          isStarting={isStarting}
          isEnding={isEnding}
        />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      セッション一覧に戻る
    </Link>
  );
}

interface SessionInfoProps {
  session: Session;
  formattedDate: string;
}

function SessionInfo({ session, formattedDate }: SessionInfoProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{session.title}</h1>
      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
        {session.session_kind && (
          <span className="bg-gray-100 px-2 py-1 rounded">
            {kindLabel(session.session_kind)}
          </span>
        )}
        <span>開始: {formattedDate}</span>
        {session.zoom_meeting_id && (
          <span>Zoom: {session.zoom_meeting_id}</span>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: Session['session_kind']): string {
  switch (kind) {
    case 'activity_command':
      return '活動指揮';
    case 'transport_coordination':
      return '搬送調整';
    case 'info_analysis':
      return '情報分析';
    case 'logistics_support':
      return '物資支援';
    default:
      return '不明';
  }
}

interface SessionActionsProps {
  status: Session['status'];
  sessionId: string;
  onStart: () => void;
  onEnd: () => void;
  isStarting: boolean;
  isEnding: boolean;
}

function SessionActions({
  status,
  sessionId,
  onStart,
  onEnd,
  isStarting,
  isEnding,
}: SessionActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {status === 'waiting' && (
        <Button
          variant="success"
          icon={Play}
          onClick={onStart}
          disabled={isStarting}
        >
          {isStarting ? '開始中...' : '開始'}
        </Button>
      )}
      {status === 'running' && (
        <Button
          variant="danger"
          icon={Square}
          onClick={onEnd}
          disabled={isEnding}
        >
          {isEnding ? '終了中...' : '終了'}
        </Button>
      )}
      <Link
        href={`/sessions/${sessionId}/record`}
        className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
      >
        <Mic className="h-5 w-5" />
        音声入力
      </Link>
      <Link
        href={`/sessions/${sessionId}/chronology`}
        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
      >
        <Clock className="h-5 w-5" />
        クロノロジー
      </Link>
    </div>
  );
}
