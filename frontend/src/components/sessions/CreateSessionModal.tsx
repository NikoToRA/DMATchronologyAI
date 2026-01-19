'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import { SESSION_KIND_OPTIONS, type CreateSessionFormData } from '@/lib/types';

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateSessionFormData) => void;
  isLoading: boolean;
}

const INITIAL_FORM_STATE: CreateSessionFormData = {
  session_kind: '',
  incident_name: '',
  zoom_meeting_id: undefined,
};

export function CreateSessionModal({
  isOpen,
  onClose,
  onCreate,
  isLoading,
}: CreateSessionModalProps) {
  const [formData, setFormData] = useState<CreateSessionFormData>(INITIAL_FORM_STATE);

  const handleChange = useCallback(
    (field: keyof CreateSessionFormData) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      },
    []
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onCreate({
        session_kind: formData.session_kind,
        incident_name: formData.incident_name,
        zoom_meeting_id: undefined,
      });
    },
    [formData, onCreate]
  );

  const handleClose = useCallback(() => {
    setFormData(INITIAL_FORM_STATE);
    onClose();
  }, [onClose]);

  const isValid = formData.incident_name.trim().length > 0 && formData.session_kind !== '';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="新規セッション作成">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <SelectInput
            id="session-kind"
            label="セッション種別"
            value={formData.session_kind}
            onChange={handleChange('session_kind')}
            options={SESSION_KIND_OPTIONS}
          />

          <TextInput
            id="incident-name"
            label="災害名（自由記載）"
            required
            value={formData.incident_name}
            onChange={handleChange('incident_name')}
            placeholder="例：能登半島地震"
          />
        </div>

        <div className="mt-6">
          <ModalFooter
            onCancel={handleClose}
            confirmLabel={isLoading ? '作成中...' : '作成'}
            isLoading={isLoading}
            isDisabled={!isValid}
          />
        </div>
      </form>
    </Modal>
  );
}
