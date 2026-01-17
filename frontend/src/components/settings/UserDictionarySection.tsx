'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, DictionaryEntry } from '@/lib/api';
import { Plus, Trash2, Pencil, Save, X, ToggleLeft, ToggleRight } from 'lucide-react';

export function UserDictionarySection() {
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ['dictionary'],
    queryFn: () => settingsApi.getDictionary().then((res) => res.data),
  });

  const [isAdding, setIsAdding] = useState(false);
  const [newWrongText, setNewWrongText] = useState('');
  const [newCorrectText, setNewCorrectText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWrongText, setEditWrongText] = useState('');
  const [editCorrectText, setEditCorrectText] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: { wrong_text: string; correct_text: string }) =>
      settingsApi.createDictionaryEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dictionary'] });
      setIsAdding(false);
      setNewWrongText('');
      setNewCorrectText('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DictionaryEntry> }) =>
      settingsApi.updateDictionaryEntry(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dictionary'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteDictionaryEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dictionary'] });
    },
  });

  const handleCreate = () => {
    if (newWrongText.trim() && newCorrectText.trim()) {
      createMutation.mutate({
        wrong_text: newWrongText.trim(),
        correct_text: newCorrectText.trim(),
      });
    }
  };

  const handleStartEdit = (entry: DictionaryEntry) => {
    setEditingId(entry.entry_id);
    setEditWrongText(entry.wrong_text);
    setEditCorrectText(entry.correct_text);
  };

  const handleSaveEdit = (id: string) => {
    if (editWrongText.trim() && editCorrectText.trim()) {
      updateMutation.mutate({
        id,
        data: {
          wrong_text: editWrongText.trim(),
          correct_text: editCorrectText.trim(),
        },
      });
    }
  };

  const handleToggleActive = (entry: DictionaryEntry) => {
    updateMutation.mutate({
      id: entry.entry_id,
      data: { active: !entry.active },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm('この辞書エントリを削除しますか？')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-24 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">ユーザー辞書</h2>
          <p className="text-sm text-gray-600 mt-1">
            音声認識の誤りを修正するための辞書を管理します（例: ディーマット → DMAT）
          </p>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            追加
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">誤認識テキスト</label>
              <input
                type="text"
                value={newWrongText}
                onChange={(e) => setNewWrongText(e.target.value)}
                placeholder="例: ディーマット"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">正しいテキスト</label>
              <input
                type="text"
                value={newCorrectText}
                onChange={(e) => setNewCorrectText(e.target.value)}
                placeholder="例: DMAT"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewWrongText('');
                setNewCorrectText('');
              }}
              className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleCreate}
              disabled={!newWrongText.trim() || !newCorrectText.trim() || createMutation.isPending}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              追加
            </button>
          </div>
        </div>
      )}

      {entries && entries.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">誤認識</th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">正しいテキスト</th>
                <th className="px-4 py-2 text-center font-medium text-gray-700 w-20">有効</th>
                <th className="px-4 py-2 text-center font-medium text-gray-700 w-24">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.entry_id} className={!entry.active ? 'bg-gray-50 opacity-60' : ''}>
                  {editingId === entry.entry_id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editWrongText}
                          onChange={(e) => setEditWrongText(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editCorrectText}
                          onChange={(e) => setEditCorrectText(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">-</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(entry.entry_id)}
                            disabled={updateMutation.isPending}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                            title="保存"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                            title="キャンセル"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-mono">{entry.wrong_text}</td>
                      <td className="px-4 py-2 font-mono">{entry.correct_text}</td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => handleToggleActive(entry)}
                          className={`p-1 rounded ${entry.active ? 'text-green-600' : 'text-gray-400'}`}
                          title={entry.active ? '有効' : '無効'}
                        >
                          {entry.active ? (
                            <ToggleRight className="h-5 w-5" />
                          ) : (
                            <ToggleLeft className="h-5 w-5" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleStartEdit(entry)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="編集"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.entry_id)}
                            disabled={deleteMutation.isPending}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                            title="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>辞書エントリがありません</p>
          <p className="text-sm mt-1">「追加」ボタンから新しいエントリを追加してください</p>
        </div>
      )}
    </div>
  );
}
