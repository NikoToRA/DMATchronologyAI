'use client';

import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckSquare, Square, Pencil, Save, X, Trash2 } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';
import type { ChronologyEntry, Participant, UpdateChronologyPayload } from '@/lib/api';
import { CategoryBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { sessionHqApi } from '@/lib/api';

interface ChronologyEntryCardProps {
  entry: ChronologyEntry;
  onUpdate: (entryId: string, data: UpdateChronologyPayload) => void;
  onDelete?: (entryId: string) => void;
  participants: Participant[] | undefined;
  sessionId: string;
}

export function ChronologyEntryCard({ entry, onUpdate, onDelete, participants, sessionId }: ChronologyEntryCardProps) {
  const dateTimeLabel = format(new Date(entry.timestamp), 'MM/dd HH:mm', {
    locale: ja,
  });

  const hasTask = entry.has_task ?? false;
  const [isEditing, setIsEditing] = useState(false);
  const [draftSummary, setDraftSummary] = useState(entry.summary);
  const [draftTextRaw, setDraftTextRaw] = useState(entry.text_raw);
  const aiNote = entry.ai_note ?? '';
  const [draftAiNote, setDraftAiNote] = useState(aiNote);
  const [draftCategory, setDraftCategory] = useState(entry.category);
  const [draftHasTask, setDraftHasTask] = useState(hasTask);
  const [draftHqId, setDraftHqId] = useState<string>(entry.hq_id ?? '');
  const [draftParticipantId, setDraftParticipantId] = useState<string>('');

  const isDirty = useMemo(() => {
    return (
      draftSummary !== entry.summary ||
      draftTextRaw !== entry.text_raw ||
      draftAiNote !== aiNote ||
      draftCategory !== entry.category ||
      draftHasTask !== hasTask ||
      draftHqId !== (entry.hq_id ?? '')
    );
  }, [draftCategory, draftHasTask, draftSummary, draftTextRaw, draftAiNote, draftHqId, entry, hasTask, aiNote]);

  const startEdit = useCallback(() => {
    setDraftSummary(entry.summary);
    setDraftTextRaw(entry.text_raw);
    setDraftAiNote(entry.ai_note ?? '');
    setDraftCategory(entry.category);
    setDraftHasTask(hasTask);
    setDraftHqId(entry.hq_id ?? '');
    setDraftParticipantId('');
    setIsEditing(true);
  }, [entry, hasTask]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraftSummary(entry.summary);
    setDraftTextRaw(entry.text_raw);
    setDraftAiNote(entry.ai_note ?? '');
    setDraftCategory(entry.category);
    setDraftHasTask(hasTask);
    setDraftHqId(entry.hq_id ?? '');
    setDraftParticipantId('');
  }, [entry, hasTask]);

  const saveEdit = useCallback(() => {
    const payload: UpdateChronologyPayload = {
      summary: draftSummary.trim(),
      text_raw: draftTextRaw.trim(),
      ai_note: draftAiNote.trim() || null,
      category: draftCategory,
      has_task: draftHasTask,
      hq_id: draftHqId ? draftHqId : null,
      is_hq_confirmed: !!draftHqId,
    };
    onUpdate(entry.entry_id, payload);
    setIsEditing(false);
  }, [draftCategory, draftHasTask, draftHqId, draftSummary, draftTextRaw, draftAiNote, entry.entry_id, onUpdate]);

  const cardClasses = `bg-white rounded-lg shadow-sm p-4 ${
    !entry.is_hq_confirmed ? 'border-l-4 border-yellow-400' : ''
  }`;

  return (
    <div className={cardClasses}>
      <div className="flex items-start gap-4">
        {/* Left aligned: date / sender / content */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <DateColumn dateTime={dateTimeLabel} />
          <SenderColumn
            senderName={entry.hq_name}
            hqId={entry.hq_id}
            isConfirmed={entry.is_hq_confirmed}
          />
          <ContentColumn
            isEditing={isEditing}
            summary={draftSummary}
            textRaw={draftTextRaw}
            aiNote={draftAiNote}
            displayAiNote={aiNote}
            onSummaryChange={setDraftSummary}
            onTextRawChange={setDraftTextRaw}
            onAiNoteChange={setDraftAiNote}
          />
        </div>

        {/* Right aligned: category / task / actions */}
        <ActionsColumn
          isEditing={isEditing}
          isDirty={isDirty}
          category={draftCategory}
          hasTask={draftHasTask}
          hqId={draftHqId}
          participants={participants}
          participantId={draftParticipantId}
          sessionId={sessionId}
          displayCategory={entry.category}
          displayHasTask={hasTask}
          entryId={entry.entry_id}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onSaveEdit={saveEdit}
          onDelete={onDelete}
          onCategoryChange={setDraftCategory}
          onHasTaskChange={setDraftHasTask}
          onHqIdChange={setDraftHqId}
          onParticipantIdChange={setDraftParticipantId}
        />
      </div>
    </div>
  );
}

interface DateColumnProps {
  dateTime: string;
}

function DateColumn({ dateTime }: DateColumnProps) {
  return (
    <div className="w-20 flex-shrink-0 text-sm text-gray-600 whitespace-nowrap">
      {dateTime}
    </div>
  );
}

interface SenderColumnProps {
  senderName: string | null | undefined;
  hqId: string | null | undefined;
  isConfirmed: boolean;
}

function SenderColumn({ senderName, hqId, isConfirmed }: SenderColumnProps) {
  const label = senderName || hqId || null;
  return (
    <div className="w-28 flex-shrink-0">
      {label && isConfirmed ? (
        <span className="font-medium text-gray-900">{label}</span>
      ) : (
        <span
          className="flex items-center gap-1 text-yellow-600"
          title="発信者（本部）が未確定です"
        >
          <AlertTriangle className="h-4 w-4" />
          {label ? '未確定' : '未確定'}
        </span>
      )}
    </div>
  );
}

interface ContentColumnProps {
  isEditing: boolean;
  summary: string;
  textRaw: string;
  aiNote: string;
  displayAiNote: string;
  onSummaryChange: (v: string) => void;
  onTextRawChange: (v: string) => void;
  onAiNoteChange: (v: string) => void;
}

function ContentColumn({ isEditing, summary, textRaw, aiNote, displayAiNote, onSummaryChange, onTextRawChange, onAiNoteChange }: ContentColumnProps) {
  return (
    <div className="flex-1 min-w-0">
      {isEditing ? (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">表題（1行）</label>
            <input
              value={summary}
              onChange={(e) => onSummaryChange(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded"
              placeholder="表題（1行）"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">AI要約（本文）</label>
            <textarea
              value={aiNote}
              onChange={(e) => onAiNoteChange(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              rows={3}
              placeholder="AI要約（本文）"
            />
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-gray-500 select-none">
              文字起こし（編集）
            </summary>
            <textarea
              value={textRaw}
              onChange={(e) => onTextRawChange(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-xs mt-1"
              rows={2}
              placeholder="文字起こし（元テキスト）"
            />
          </details>
        </div>
      ) : (
        <>
          {/* Title (1-line) */}
          <p className="font-medium text-gray-900">{summary}</p>
          {/* AI note (preferred). If absent, show nothing here. */}
          {!!displayAiNote && (
            <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
              {displayAiNote}
            </p>
          )}
          {/* Transcript is stored but hidden by default */}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-gray-500 select-none">
              文字起こし（非表示）
            </summary>
            <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">
              {textRaw}
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function ActionsColumn({
  isEditing,
  isDirty,
  category,
  hasTask,
  hqId,
  participants,
  participantId,
  sessionId,
  displayCategory,
  displayHasTask,
  entryId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onCategoryChange,
  onHasTaskChange,
  onHqIdChange,
  onParticipantIdChange,
}: {
  isEditing: boolean;
  isDirty: boolean;
  category: ChronologyEntry['category'];
  hasTask: boolean;
  hqId: string;
  participants: Participant[] | undefined;
  participantId: string;
  sessionId: string;
  displayCategory: ChronologyEntry['category'];
  displayHasTask: boolean;
  entryId: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete?: (entryId: string) => void;
  onCategoryChange: (c: ChronologyEntry['category']) => void;
  onHasTaskChange: (v: boolean) => void;
  onHqIdChange: (v: string) => void;
  onParticipantIdChange: (v: string) => void;
}) {
  const participantOptions = buildParticipantOptions(participants);
  return (
    <div className="w-44 flex-shrink-0 flex flex-col items-end gap-2">
      {isEditing ? (
        <>
          <select
            value={participantId}
            onChange={async (e) => {
              const pid = e.target.value;
              if (pid === '__new__') {
                const name = window.prompt('発信者（本部名）を入力してください（自由記載）');
                if (!name || !name.trim()) return;
                const created = await sessionHqApi.create(sessionId, { hq_name: name.trim(), zoom_pattern: name.trim() });
                // manual HQ assignment (phone/口頭など)
                onHqIdChange(created.data.hq_id);
                onParticipantIdChange('');
                return;
              }

              onParticipantIdChange(pid);
              if (!pid) {
                onHqIdChange('');
                return;
              }

              const p = participants?.find((x) => x.participant_id === pid);
              onHqIdChange(p?.hq_id ?? '');
            }}
            className="px-2 py-1 border border-gray-300 rounded text-sm w-full"
            title="発信者（Zoom参加者）"
          >
            <option value="">発信者: 未確定</option>
            {participantOptions.map((opt) => (
              <option key={opt.participant_id} value={opt.participant_id}>
                {opt.label}
              </option>
            ))}
            <option value="__new__">＋発信者（本部）を追加（自由記載）</option>
          </select>
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value as ChronologyEntry['category'])}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            {(['指示', '依頼', '報告', '決定', '確認', 'リスク', 'その他'] as const).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={hasTask}
              onChange={(e) => onHasTaskChange(e.target.checked)}
            />
            タスクあり
          </label>
          <div className="flex items-center gap-1">
            <IconButton
              icon={Save}
              variant="success"
              label="保存"
              onClick={onSaveEdit}
              disabled={!isDirty}
            />
            <IconButton icon={X} variant="ghost" label="キャンセル" onClick={onCancelEdit} />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">分類</span>
              <CategoryBadge category={displayCategory} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">タスク</span>
              <span
                className={`inline-flex items-center gap-1 text-sm ${
                  displayHasTask ? 'text-blue-700' : 'text-gray-400'
                }`}
              >
                {displayHasTask ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {displayHasTask ? 'あり' : 'なし'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton icon={Pencil} variant="ghost" label="編集" onClick={onStartEdit} />
            {onDelete && (
              <IconButton
                icon={Trash2}
                variant="danger"
                label="削除"
                onClick={() => {
                  if (window.confirm('このクロノロジーエントリを削除しますか？')) {
                    onDelete(entryId);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildParticipantOptions(
  participants: Participant[] | undefined
): Array<{ participant_id: string; label: string }> {
  if (!participants || participants.length === 0) return [];

  return [...participants]
    .map((p) => {
      const suffix = p.hq_name ? `（${p.hq_name}）` : '';
      return {
        participant_id: p.participant_id,
        label: `${p.zoom_display_name}${suffix}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}
