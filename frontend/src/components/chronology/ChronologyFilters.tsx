'use client';

import { Filter } from 'lucide-react';
import type { ChronologyCategory, Participant, HQMaster } from '@/lib/api';
import type { ChronologyFilters as FiltersType } from '@/hooks/useChronology';
import { CHRONOLOGY_CATEGORIES } from '@/hooks/useChronology';
import { Checkbox } from '@/components/ui/FormField';

interface ChronologyFiltersProps {
  filters: FiltersType;
  participants: Participant[] | undefined;
  hqMaster?: HQMaster[] | undefined;
  onCategoryChange: (category: ChronologyCategory | '') => void;
  onHqChange: (hqId: string) => void;
  onUnconfirmedOnlyChange: (unconfirmedOnly: boolean) => void;
}

export function ChronologyFilters({
  filters,
  participants,
  hqMaster,
  onCategoryChange,
  onHqChange,
  onUnconfirmedOnlyChange,
}: ChronologyFiltersProps) {
  return (
    <div className="flex items-center gap-4 px-4 pb-4 bg-white border-b border-gray-200">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-500">フィルタ:</span>
      </div>

      <CategorySelect
        value={filters.category}
        onChange={onCategoryChange}
      />

      <HQSelect
        value={filters.hqId}
        participants={participants}
        hqMaster={hqMaster}
        onChange={onHqChange}
      />

      <Checkbox
        label="発信者未確定のみ"
        checked={filters.unconfirmedOnly}
        onChange={(e) => onUnconfirmedOnlyChange(e.target.checked)}
      />
    </div>
  );
}

interface CategorySelectProps {
  value: ChronologyCategory | '';
  onChange: (category: ChronologyCategory | '') => void;
}

function CategorySelect({ value, onChange }: CategorySelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ChronologyCategory | '')}
      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
    >
      {CHRONOLOGY_CATEGORIES.map((cat) => (
        <option key={cat.value} value={cat.value}>
          種別: {cat.label}
        </option>
      ))}
    </select>
  );
}

interface HQSelectProps {
  value: string;
  participants: Participant[] | undefined;
  hqMaster?: HQMaster[] | undefined;
  onChange: (hqId: string) => void;
}

function HQSelect({ value, participants, hqMaster, onChange }: HQSelectProps) {
  // hqMasterがある場合はそれを優先、なければparticipantsからフォールバック
  const speakerOptions = hqMaster && hqMaster.length > 0
    ? buildHqMasterOptions(hqMaster)
    : buildSpeakerOptions(participants);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
    >
      <option value="">発信者: すべて</option>
      {speakerOptions.map((opt) => (
        <option key={opt.hq_id} value={opt.hq_id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function buildHqMasterOptions(hqMaster: HQMaster[]): Array<{ hq_id: string; label: string }> {
  return hqMaster
    .filter((hq) => hq.active)
    .map((hq) => ({ hq_id: hq.hq_id, label: hq.hq_name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

function buildSpeakerOptions(participants: Participant[] | undefined): Array<{ hq_id: string; label: string }> {
  if (!participants || participants.length === 0) return [];

  // Only speakers resolved from Zoom participants (hq_id present); unique by hq_id.
  const map = new Map<string, string>();
  for (const p of participants) {
    if (!p.hq_id) continue;
    const label = (p.hq_name && p.hq_name.trim()) || p.zoom_display_name;
    if (!map.has(p.hq_id)) map.set(p.hq_id, label);
  }

  return Array.from(map.entries())
    .map(([hq_id, label]) => ({ hq_id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}
