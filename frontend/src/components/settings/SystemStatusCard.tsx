'use client';

import { Settings, CheckCircle, XCircle } from 'lucide-react';
import type { SystemStatus } from '@/lib/api';

interface SystemStatusCardProps {
  status: SystemStatus | undefined;
}

export function SystemStatusCard({ status }: SystemStatusCardProps) {
  return (
    <div className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Settings className="h-5 w-5" />
        システム状態
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <StatusItem
          label="Zoom API"
          configured={status?.zoom_configured ?? false}
        />
        <StatusItem
          label="Azure Speech (STT)"
          configured={status?.stt_configured ?? false}
        />
        <StatusItem
          label="Azure OpenAI"
          configured={status?.openai_configured ?? false}
        />
        <StorageTypeItem storageType={status?.storage_type} />
      </div>
    </div>
  );
}

interface StatusItemProps {
  label: string;
  configured: boolean;
}

function StatusItem({ label, configured }: StatusItemProps) {
  const Icon = configured ? CheckCircle : XCircle;
  const iconColor = configured ? 'text-green-500' : 'text-red-500';
  const textColor = configured ? 'text-green-600' : 'text-red-600';
  const statusText = configured ? '設定済み' : '未設定';

  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-5 w-5 ${iconColor}`} />
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-medium ${textColor}`}>{statusText}</span>
    </div>
  );
}

interface StorageTypeItemProps {
  storageType: 'azure' | 'local' | undefined;
}

function StorageTypeItem({ storageType }: StorageTypeItemProps) {
  const displayText = storageType === 'azure' ? 'Azure Blob' : 'ローカル';

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">ストレージ:</span>
      <span className="text-sm font-medium">{displayText}</span>
    </div>
  );
}
