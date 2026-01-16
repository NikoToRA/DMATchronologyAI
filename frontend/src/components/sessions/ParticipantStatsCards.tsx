'use client';

import { type ReactNode } from 'react';
import { Users, CheckCircle, AlertCircle } from 'lucide-react';
import type { ParticipantStats } from '@/hooks/useSession';

interface ParticipantStatsCardsProps {
  stats: ParticipantStats;
}

export function ParticipantStatsCards({ stats }: ParticipantStatsCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <StatsCard
        icon={<Users className="h-8 w-8 text-primary-500" />}
        label="総参加者"
        value={stats.total}
      />
      <StatsCard
        icon={<CheckCircle className="h-8 w-8 text-green-500" />}
        label="本部確定"
        value={stats.confirmed}
      />
      <StatsCard
        icon={<AlertCircle className="h-8 w-8 text-yellow-500" />}
        label="未確定"
        value={stats.unconfirmed}
      />
    </div>
  );
}

interface StatsCardProps {
  icon: ReactNode;
  label: string;
  value: number;
}

function StatsCard({ icon, label, value }: StatsCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
