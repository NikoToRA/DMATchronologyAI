'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Play, Square, Clock, Users, FileText } from 'lucide-react';
import { type Session } from '@/lib/api';
import { StatusBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';

interface SessionTableProps {
  sessions: Session[];
  onStart: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
}

export function SessionTable({ sessions, onStart, onEnd }: SessionTableProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>タイトル</th>
            <th>種別</th>
            <th>状態</th>
            <th>開始日時</th>
            <th>参加者</th>
            <th>エントリ</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sessions.map((session) => (
            <SessionTableRow
              key={session.session_id}
              session={session}
              onStart={onStart}
              onEnd={onEnd}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SessionTableRowProps {
  session: Session;
  onStart: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
}

function SessionTableRow({ session, onStart, onEnd }: SessionTableRowProps) {
  const formattedDate = format(new Date(session.start_at), 'yyyy/MM/dd HH:mm', {
    locale: ja,
  });

  return (
    <tr>
      <td>
        <Link
          href={`/sessions/${session.session_id}/chronology`}
          className="text-primary-600 hover:text-primary-800 font-medium"
        >
          {session.title}
        </Link>
      </td>
      <td>{kindLabel(session.session_kind) ?? '-'}</td>
      <td>
        <StatusBadge status={session.status} />
      </td>
      <td>{formattedDate}</td>
      <td>
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4 text-gray-400" />
          {session.participant_count ?? 0}
        </div>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <FileText className="h-4 w-4 text-gray-400" />
          {session.entry_count ?? 0}
        </div>
      </td>
      <td>
        <SessionActions
          session={session}
          onStart={onStart}
          onEnd={onEnd}
        />
      </td>
    </tr>
  );
}

function kindLabel(kind: Session['session_kind']): string | null {
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
      return null;
  }
}

interface SessionActionsProps {
  session: Session;
  onStart: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
}

function SessionActions({ session, onStart, onEnd }: SessionActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {session.status === 'waiting' && (
        <IconButton
          icon={Play}
          variant="success"
          label="開始"
          onClick={() => onStart(session.session_id)}
        />
      )}
      {session.status === 'running' && (
        <IconButton
          icon={Square}
          variant="danger"
          label="終了"
          onClick={() => onEnd(session.session_id)}
        />
      )}
      <Link
        href={`/sessions/${session.session_id}/chronology`}
        className="p-1 text-primary-600 hover:bg-primary-50 rounded"
        title="クロノロジー"
      >
        <Clock className="h-5 w-5" />
      </Link>
    </div>
  );
}
