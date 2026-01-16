'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Video, Edit2 } from 'lucide-react';
import { settingsApi, type ZoomCredentials } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TextInput, PasswordInput } from '@/components/ui/FormField';
import type { ZoomCredentialsFormData } from '@/lib/types';

const INITIAL_FORM_STATE: ZoomCredentialsFormData = {
  client_id: '',
  client_secret: '',
  account_id: '',
};

export function ZoomCredentialsSection() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ZoomCredentialsFormData>(INITIAL_FORM_STATE);

  const { data: credentials } = useQuery({
    queryKey: ['zoomCredentials'],
    queryFn: () => settingsApi.getZoomCredentials().then((res) => res.data),
  });

  const mutation = useMutation({
    mutationFn: settingsApi.updateZoomCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zoomCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['systemStatus'] });
      setIsEditing(false);
    },
  });

  const handleEdit = useCallback(() => {
    setFormData({
      client_id: credentials?.client_id ?? '',
      client_secret: '',
      account_id: credentials?.account_id ?? '',
    });
    setIsEditing(true);
  }, [credentials]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setFormData(INITIAL_FORM_STATE);
  }, []);

  const handleSave = useCallback(() => {
    mutation.mutate(formData);
  }, [mutation, formData]);

  const handleChange = useCallback(
    (field: keyof ZoomCredentialsFormData) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      },
    []
  );

  return (
    <div className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Video className="h-5 w-5" />
        Zoom API設定
      </h2>

      {isEditing ? (
        <ZoomCredentialsForm
          formData={formData}
          onChange={handleChange}
          onSave={handleSave}
          onCancel={handleCancel}
          isLoading={mutation.isPending}
        />
      ) : (
        <ZoomCredentialsDisplay
          credentials={credentials}
          onEdit={handleEdit}
        />
      )}
    </div>
  );
}

interface ZoomCredentialsFormProps {
  formData: ZoomCredentialsFormData;
  onChange: (field: keyof ZoomCredentialsFormData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function ZoomCredentialsForm({
  formData,
  onChange,
  onSave,
  onCancel,
  isLoading,
}: ZoomCredentialsFormProps) {
  return (
    <div className="space-y-4">
      <TextInput
        id="zoom-client-id"
        label="Client ID"
        value={formData.client_id}
        onChange={onChange('client_id')}
      />
      <PasswordInput
        id="zoom-client-secret"
        label="Client Secret"
        value={formData.client_secret}
        onChange={onChange('client_secret')}
        placeholder="変更する場合のみ入力"
      />
      <TextInput
        id="zoom-account-id"
        label="Account ID"
        value={formData.account_id}
        onChange={onChange('account_id')}
      />
      <div className="flex gap-2">
        <Button onClick={onSave} disabled={isLoading}>
          {isLoading ? '保存中...' : '保存'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}

interface ZoomCredentialsDisplayProps {
  credentials: ZoomCredentials | undefined;
  onEdit: () => void;
}

function ZoomCredentialsDisplay({ credentials, onEdit }: ZoomCredentialsDisplayProps) {
  return (
    <div>
      <div className="space-y-2 mb-4">
        <CredentialRow label="Client ID" value={credentials?.client_id} />
        <CredentialRow label="Client Secret" value={credentials?.client_secret} />
        <CredentialRow label="Account ID" value={credentials?.account_id} />
      </div>
      <Button variant="secondary" icon={Edit2} onClick={onEdit}>
        編集
      </Button>
    </div>
  );
}

interface CredentialRowProps {
  label: string;
  value: string | undefined;
}

function CredentialRow({ label, value }: CredentialRowProps) {
  return (
    <div className="flex">
      <span className="w-32 text-sm text-gray-500">{label}:</span>
      <span className="text-sm">{value ?? '未設定'}</span>
    </div>
  );
}
