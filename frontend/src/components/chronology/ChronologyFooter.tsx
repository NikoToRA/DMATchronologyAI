'use client';

import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ChronologyStats } from '@/hooks/useChronology';

interface ChronologyFooterProps {
  stats: ChronologyStats;
}

export function ChronologyFooter({ stats }: ChronologyFooterProps) {
  const formattedLastUpdate = stats.latestTimestamp
    ? format(new Date(stats.latestTimestamp), 'HH:mm:ss', { locale: ja })
    : '-';

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-2 text-sm text-gray-500">
      <div className="flex items-center justify-between">
        <span>表示中: {stats.total} 件</span>
        <span>最終更新: {formattedLastUpdate}</span>
      </div>
    </div>
  );
}
