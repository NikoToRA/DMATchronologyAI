'use client';

import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import {
  SystemStatusCard,
  // ZoomCredentialsSection,  // Push-to-Talk方式では不要
  LLMPromptSection,
  UserDictionarySection,
} from '@/components/settings';

export default function SettingsPage() {
  const { data: status } = useQuery({
    queryKey: ['systemStatus'],
    queryFn: () => settingsApi.getStatus().then((res) => res.data),
  });

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">設定</h1>

      <SystemStatusCard status={status} />
      {/* ZoomCredentialsSection は Push-to-Talk方式では不要なため非表示 */}
      <LLMPromptSection />
      <UserDictionarySection />
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <div className="font-semibold text-gray-900">本部マスタについて</div>
        <div className="mt-1 text-gray-600">
          本部マスタは「災害ボックス」ごとに管理します（全体設定では管理しません）。
        </div>
      </div>
    </div>
  );
}
