'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { settingsApi, type HQMaster } from '@/lib/api';
import { Button, IconButton } from '@/components/ui/Button';
import { InlineInput } from '@/components/ui/FormField';
import { ActiveBadge } from '@/components/ui/Badge';
import type { HQFormData } from '@/lib/types';

const INITIAL_HQ_STATE: HQFormData = {
  hq_name: '',
  zoom_pattern: '',
};

export function HQMasterSection() {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newHQ, setNewHQ] = useState<HQFormData>(INITIAL_HQ_STATE);

  const { data: hqList } = useQuery({
    queryKey: ['settings', 'hqMaster'],
    queryFn: () => settingsApi.getHQMaster().then((res) => res.data),
  });

  const createMutation = useMutation({
    mutationFn: settingsApi.createHQ,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'hqMaster'] });
      setIsAdding(false);
      setNewHQ(INITIAL_HQ_STATE);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<HQMaster> }) =>
      settingsApi.updateHQ(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'hqMaster'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: settingsApi.deleteHQ,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'hqMaster'] });
    },
  });

  const handleStartAdding = useCallback(() => {
    setIsAdding(true);
  }, []);

  const handleCancelAdding = useCallback(() => {
    setIsAdding(false);
    setNewHQ(INITIAL_HQ_STATE);
  }, []);

  const handleCreate = useCallback(() => {
    createMutation.mutate(newHQ);
  }, [createMutation, newHQ]);

  const handleToggleActive = useCallback(
    (hq: HQMaster) => {
      updateMutation.mutate({
        id: hq.hq_id,
        data: { active: !hq.active },
      });
    },
    [updateMutation]
  );

  const handleDelete = useCallback(
    (hqId: string) => {
      if (confirm('この本部を削除しますか？')) {
        deleteMutation.mutate(hqId);
      }
    },
    [deleteMutation]
  );

  const handleNewHQChange = useCallback(
    (field: keyof HQFormData) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewHQ((prev) => ({ ...prev, [field]: e.target.value }));
      },
    []
  );

  const isNewHQValid = newHQ.hq_name.trim() !== '' && newHQ.zoom_pattern.trim() !== '';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          本部マスタ
        </h2>
        <Button size="sm" icon={Plus} onClick={handleStartAdding}>
          追加
        </Button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>本部名</th>
            <th>Zoomパターン</th>
            <th>状態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {isAdding && (
            <AddHQRow
              newHQ={newHQ}
              onChange={handleNewHQChange}
              onSave={handleCreate}
              onCancel={handleCancelAdding}
              isDisabled={!isNewHQValid}
            />
          )}
          {hqList?.map((hq) => (
            <HQTableRow
              key={hq.hq_id}
              hq={hq}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete}
            />
          ))}
        </tbody>
      </table>

      {(!hqList || hqList.length === 0) && !isAdding && (
        <div className="text-center py-8 text-gray-500">
          本部が登録されていません
        </div>
      )}
    </div>
  );
}

interface AddHQRowProps {
  newHQ: HQFormData;
  onChange: (field: keyof HQFormData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onCancel: () => void;
  isDisabled: boolean;
}

function AddHQRow({ newHQ, onChange, onSave, onCancel, isDisabled }: AddHQRowProps) {
  return (
    <tr>
      <td>
        <InlineInput
          value={newHQ.hq_name}
          onChange={onChange('hq_name')}
          placeholder="本部名"
        />
      </td>
      <td>
        <InlineInput
          value={newHQ.zoom_pattern}
          onChange={onChange('zoom_pattern')}
          placeholder="Zoomパターン"
        />
      </td>
      <td>-</td>
      <td>
        <div className="flex items-center gap-1">
          <IconButton
            icon={Check}
            variant="success"
            label="保存"
            onClick={onSave}
            disabled={isDisabled}
          />
          <IconButton
            icon={X}
            variant="ghost"
            label="キャンセル"
            onClick={onCancel}
          />
        </div>
      </td>
    </tr>
  );
}

interface HQTableRowProps {
  hq: HQMaster;
  onToggleActive: (hq: HQMaster) => void;
  onDelete: (hqId: string) => void;
}

function HQTableRow({ hq, onToggleActive, onDelete }: HQTableRowProps) {
  return (
    <tr>
      <td>{hq.hq_name}</td>
      <td className="font-mono text-sm">{hq.zoom_pattern}</td>
      <td>
        <ActiveBadge active={hq.active} />
      </td>
      <td>
        <div className="flex items-center gap-1">
          <IconButton
            icon={Edit2}
            variant="primary"
            label={hq.active ? '無効にする' : '有効にする'}
            onClick={() => onToggleActive(hq)}
          />
          <IconButton
            icon={Trash2}
            variant="danger"
            label="削除"
            onClick={() => onDelete(hq.hq_id)}
          />
        </div>
      </td>
    </tr>
  );
}
