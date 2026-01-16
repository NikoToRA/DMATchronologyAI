import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Edit2, CheckCircle } from 'lucide-react';
import type { Participant, HQMaster, UpdateParticipantPayload } from '@/lib/api';
import { ConnectionBadge, IdentificationBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { InlineLoading } from '@/components/ui/LoadingState';

interface ParticipantTableProps {
  participants: Participant[];
  hqMaster: HQMaster[] | undefined;
  onUpdateParticipant: (participantId: string, data: UpdateParticipantPayload) => void;
  onCreateHQ?: (hqName: string) => Promise<string>; // returns created hq_id
  isLoading?: boolean;
}

export function ParticipantTable({
  participants,
  hqMaster,
  onUpdateParticipant,
  onCreateHQ,
  isLoading = false,
}: ParticipantTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleHqChange = useCallback(
    (participantId: string, hqId: string) => {
      onUpdateParticipant(participantId, { hq_id: hqId || null });
      setEditingId(null);
    },
    [onUpdateParticipant]
  );

  const handleStartEdit = useCallback((participantId: string) => {
    setEditingId(participantId);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold">参加本部リスト</h2>
      </div>

      {isLoading ? (
        <InlineLoading />
      ) : participants.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>本部名</th>
              <th>Zoomユーザーネーム</th>
              <th>接続状態</th>
              <th>最終発言時刻</th>
              <th>識別状態</th>
              <th>宣言済み</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {participants.map((participant) => (
              <ParticipantRow
                key={participant.participant_id}
                participant={participant}
                hqMaster={hqMaster}
                isEditing={editingId === participant.participant_id}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onHqChange={handleHqChange}
                onCreateHQ={onCreateHQ}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-8 text-center text-gray-500">
          参加者がいません
        </div>
      )}
    </div>
  );
}

interface ParticipantRowProps {
  participant: Participant;
  hqMaster: HQMaster[] | undefined;
  isEditing: boolean;
  onStartEdit: (participantId: string) => void;
  onCancelEdit: () => void;
  onHqChange: (participantId: string, hqId: string) => void;
  onCreateHQ?: (hqName: string) => Promise<string>;
}

function ParticipantRow({
  participant,
  hqMaster,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onHqChange,
  onCreateHQ,
}: ParticipantRowProps) {
  const formattedLastSpeech = participant.last_speech_at
    ? format(new Date(participant.last_speech_at), 'HH:mm:ss', { locale: ja })
    : '-';

  return (
    <tr>
      <td>
        {isEditing ? (
          <HQSelect
            hqMaster={hqMaster}
            currentHqId={participant.hq_id}
            onChange={(hqId) => onHqChange(participant.participant_id, hqId)}
            onCreateHQ={onCreateHQ}
          />
        ) : (
          <span className={!participant.hq_name ? 'text-gray-400' : ''}>
            {participant.hq_name ?? '?'}
          </span>
        )}
      </td>
      <td>{participant.zoom_display_name}</td>
      <td>
        <ConnectionBadge status={participant.connection_status} />
      </td>
      <td>{formattedLastSpeech}</td>
      <td>
        <IdentificationBadge
          status={participant.identification_status ?? '未確定'}
        />
      </td>
      <td>
        {participant.is_declared ? (
          <CheckCircle className="h-5 w-5 text-green-500" />
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>
      <td>
        {isEditing ? (
          <button
            onClick={onCancelEdit}
            className="text-gray-500 hover:text-gray-700"
          >
            キャンセル
          </button>
        ) : (
          <IconButton
            icon={Edit2}
            variant="primary"
            label="紐づけ修正"
            onClick={() => onStartEdit(participant.participant_id)}
          />
        )}
      </td>
    </tr>
  );
}

interface HQSelectProps {
  hqMaster: HQMaster[] | undefined;
  currentHqId: string | null;
  onChange: (hqId: string) => void;
  onCreateHQ?: (hqName: string) => Promise<string>;
}

function HQSelect({ hqMaster, currentHqId, onChange, onCreateHQ }: HQSelectProps) {
  return (
    <select
      defaultValue={currentHqId ?? ''}
      onChange={async (e) => {
        const value = e.target.value;
        if (value !== '__new__') {
          onChange(value);
          return;
        }

        const name = window.prompt('追加する本部名を入力してください（自由記載）');
        if (!name || !name.trim()) {
          // Revert selection to current
          onChange(currentHqId ?? '');
          return;
        }
        if (!onCreateHQ) {
          window.alert('本部の追加が利用できません（onCreateHQ未設定）');
          onChange(currentHqId ?? '');
          return;
        }

        try {
          const createdId = await onCreateHQ(name.trim());
          onChange(createdId);
        } catch {
          window.alert('本部の追加に失敗しました');
          onChange(currentHqId ?? '');
        }
      }}
      className="w-full px-2 py-1 border border-gray-300 rounded"
    >
      <option value="">未選択</option>
      {hqMaster?.map((hq) => (
        <option key={hq.hq_id} value={hq.hq_id}>
          {hq.hq_name}
        </option>
      ))}
      <option value="__new__">＋本部を追加（自由記載）</option>
    </select>
  );
}
