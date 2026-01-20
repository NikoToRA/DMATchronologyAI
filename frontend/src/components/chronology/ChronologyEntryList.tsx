'use client';

import { type RefObject } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ChronologyEntry } from '@/lib/api';
import { LoadingPlaceholder, EmptyState } from '@/components/ui/LoadingState';
import { ChronologyEntryCard } from './ChronologyEntryCard';
import type { UpdateChronologyPayload } from '@/lib/api';
import type { Participant } from '@/lib/api';

interface ChronologyEntryListProps {
  entries: ChronologyEntry[] | undefined;
  isLoading: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  onUpdateEntry: (entryId: string, data: UpdateChronologyPayload) => void;
  onDeleteEntry?: (entryId: string) => void;
  participants: Participant[] | undefined;
  sessionId: string;
}

export function ChronologyEntryList({
  entries,
  isLoading,
  scrollRef,
  onUpdateEntry,
  onDeleteEntry,
  participants,
  sessionId,
}: ChronologyEntryListProps) {
  // データがある場合は読み込み中でも表示（バックグラウンド更新時にUIが消えない）
  // 初回読み込み時（データなし）のみローディング表示
  if (isLoading && (!entries || entries.length === 0)) {
    return (
      <div className="flex-1 overflow-auto bg-gray-50 p-4">
        <LoadingPlaceholder />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex-1 overflow-auto bg-gray-50 p-4">
        <EmptyState title="クロノロジーエントリがありません" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50 p-4">
      <ChronologyColumnsHeader />
      <div className="space-y-2">
        {entries.map((entry, idx) => {
          const currentDate = format(new Date(entry.timestamp), 'yyyy/MM/dd', { locale: ja });
          const prev = entries[idx - 1];
          const prevDate = prev
            ? format(new Date(prev.timestamp), 'yyyy/MM/dd', { locale: ja })
            : null;
          const showDateSeparator = idx === 0 || prevDate !== currentDate;

          return (
            <div key={entry.entry_id} className="space-y-2">
              {showDateSeparator && <DateSeparator dateLabel={currentDate} />}
              <ChronologyEntryCard
                entry={entry}
                onUpdate={onUpdateEntry}
                onDelete={onDeleteEntry}
                participants={participants}
                sessionId={sessionId}
              />
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

function DateSeparator({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="py-2">
      <div className="mx-auto w-fit px-3 py-1 rounded-full bg-gray-200 text-gray-700 text-sm">
        {dateLabel}
      </div>
    </div>
  );
}

function ChronologyColumnsHeader() {
  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 pb-3 bg-gray-50 border-b border-gray-200">
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <div className="w-20 flex-shrink-0">時間</div>
        <div className="w-28 flex-shrink-0">発信</div>
        <div className="flex-1 min-w-0">内容</div>
        <div className="w-44 flex-shrink-0 text-right">分類 / タスク</div>
      </div>
    </div>
  );
}
