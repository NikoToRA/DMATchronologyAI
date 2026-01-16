'use client';

import { useParams } from 'next/navigation';
import { useSession, useParticipantStats } from '@/hooks';
import { LoadingPlaceholder, EmptyState } from '@/components/ui/LoadingState';
import {
  SessionHeader,
  ParticipantStatsCards,
  ParticipantTable,
} from '@/components/sessions';
import { sessionHqApi } from '@/lib/api';

export default function SessionParticipantsPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const {
    session,
    participants,
    hqMaster,
    isSessionLoading,
    isParticipantsLoading,
    startSession,
    endSession,
    updateParticipant,
    isStarting,
    isEnding,
  } = useSession(sessionId);

  const stats = useParticipantStats(participants);

  if (isSessionLoading) {
    return (
      <div className="p-6">
        <LoadingPlaceholder />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6">
        <EmptyState title="セッションが見つかりません" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <SessionHeader
        session={session}
        onStart={startSession}
        onEnd={endSession}
        isStarting={isStarting}
        isEnding={isEnding}
      />

      <ParticipantStatsCards stats={stats} />

      <ParticipantTable
        participants={participants ?? []}
        hqMaster={hqMaster}
        onUpdateParticipant={updateParticipant}
        onCreateHQ={async (hqName: string) => {
          // Minimal free-text HQ creation: pattern == name
          const created = await sessionHqApi.create(sessionId, { hq_name: hqName, zoom_pattern: hqName });
          return created.data.hq_id;
        }}
        isLoading={isParticipantsLoading}
      />
    </div>
  );
}

