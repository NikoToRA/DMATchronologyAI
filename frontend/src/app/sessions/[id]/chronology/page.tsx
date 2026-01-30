'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useChronology, useChronologyAutoScroll } from '@/hooks';
import {
  ChronologyHeader,
  ChronologyFilters,
  ChronologyEntryList,
  ChronologyFooter,
} from '@/components/chronology';

export default function ChronologyPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const {
    entries,
    session,
    participants,
    hqMaster,
    isEntriesLoading,
    updateEntry,
    filters,
    setFilters,
    refetch,
    stats,
  } = useChronology(sessionId);

  const { scrollRef, autoScroll, setAutoScroll } = useChronologyAutoScroll(entries);

  // Filter handlers
  const handleCategoryChange = useCallback(
    (category: typeof filters.category) => {
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

  return (
    <div className="h-full flex flex-col">
      <ChronologyHeader
        session={session}
        sessionId={sessionId}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
        onRefresh={refetch}
      />

      <ChronologyFilters
        filters={filters}
        participants={participants}
        hqMaster={hqMaster}
        onCategoryChange={handleCategoryChange}
        onHqChange={handleHqChange}
        onUnconfirmedOnlyChange={handleUnconfirmedOnlyChange}
      />

      <ChronologyEntryList
        entries={entries}
        isLoading={isEntriesLoading}
        scrollRef={scrollRef}
        onUpdateEntry={updateEntry}
        participants={participants}
        sessionId={sessionId}
      />

      <ChronologyFooter stats={stats} />
    </div>
  );
}
