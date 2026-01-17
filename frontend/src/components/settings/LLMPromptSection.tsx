'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, LLMSettings } from '@/lib/api';
import { RotateCcw, Save } from 'lucide-react';

export function LLMPromptSection() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['llmSettings'],
    queryFn: () => settingsApi.getLLMSettings().then((res) => res.data),
  });

  const { data: defaultPromptData } = useQuery({
    queryKey: ['defaultLLMPrompt'],
    queryFn: () => settingsApi.getDefaultLLMPrompt().then((res) => res.data),
  });

  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(100);
  const [isEditing, setIsEditing] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<LLMSettings>) => settingsApi.updateLLMSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      setIsEditing(false);
    },
  });

  const handleEdit = () => {
    if (settings) {
      setSystemPrompt(settings.system_prompt);
      setTemperature(settings.temperature);
      setMaxTokens(settings.max_tokens);
    }
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
    });
  };

  const handleReset = () => {
    if (defaultPromptData?.default_prompt) {
      setSystemPrompt(defaultPromptData.default_prompt);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">LLMプロンプト設定</h2>
          <p className="text-sm text-gray-600 mt-1">
            AIによるクロノロジー分類・要約に使用するプロンプトを調整できます
          </p>
        </div>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            編集
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                システムプロンプト
              </label>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                title="デフォルトに戻す"
              >
                <RotateCcw className="h-3 w-3" />
                デフォルトに戻す
              </button>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              placeholder="システムプロンプトを入力..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature ({temperature})
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                低い値 = より一貫した出力、高い値 = よりクリエイティブな出力
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最大トークン数
              </label>
              <input
                type="number"
                min="1"
                max="4000"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 100)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                AIの応答の最大長を制限します（1-4000）
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {updateMutation.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-sm text-gray-500 mb-1">現在のプロンプト（プレビュー）</div>
            <pre className="text-xs bg-gray-50 p-3 rounded border overflow-auto max-h-48 whitespace-pre-wrap">
              {settings?.system_prompt || '(デフォルト)'}
            </pre>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-gray-500">Temperature:</span>{' '}
              <span className="font-medium">{settings?.temperature ?? 0.3}</span>
            </div>
            <div>
              <span className="text-gray-500">Max Tokens:</span>{' '}
              <span className="font-medium">{settings?.max_tokens ?? 100}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
