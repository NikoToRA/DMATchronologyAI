// Shared types for the ChronologyAI frontend

// Session status types
export type SessionStatus = 'waiting' | 'running' | 'ended';

// Identification status types
export type IdentificationStatus = '確定' | '未確定';

// Connection status types
export type ConnectionStatus = '参加中' | '退出';

// Category types
export type ChronologyCategory = '指示' | '依頼' | '報告' | '決定' | '確認' | 'リスク' | 'その他';

// Category configuration for UI
export interface CategoryConfig {
  value: ChronologyCategory | '';
  label: string;
  className: string;
}

export const CATEGORY_CONFIGS: Record<ChronologyCategory, CategoryConfig> = {
  '指示': { value: '指示', label: '指示', className: 'bg-red-100 text-red-800' },
  '依頼': { value: '依頼', label: '依頼', className: 'bg-yellow-100 text-yellow-800' },
  '報告': { value: '報告', label: '報告', className: 'bg-blue-100 text-blue-800' },
  '決定': { value: '決定', label: '決定', className: 'bg-green-100 text-green-800' },
  '確認': { value: '確認', label: '確認', className: 'bg-purple-100 text-purple-800' },
  'リスク': { value: 'リスク', label: 'リスク', className: 'bg-orange-100 text-orange-800' },
  'その他': { value: 'その他', label: 'その他', className: 'bg-gray-100 text-gray-800' },
} as const;

export const CATEGORY_OPTIONS: Array<{ value: ChronologyCategory | ''; label: string }> = [
  { value: '', label: 'すべて' },
  { value: '指示', label: '指示' },
  { value: '依頼', label: '依頼' },
  { value: '報告', label: '報告' },
  { value: '決定', label: '決定' },
  { value: '確認', label: '確認' },
  { value: 'リスク', label: 'リスク' },
  { value: 'その他', label: 'その他' },
] as const;

// Session status configuration
export interface StatusConfig {
  className: string;
  label: string;
}

export const SESSION_STATUS_CONFIGS: Record<SessionStatus, StatusConfig> = {
  waiting: { className: 'bg-yellow-100 text-yellow-800', label: '待機中' },
  running: { className: 'bg-green-100 text-green-800', label: '実行中' },
  ended: { className: 'bg-gray-100 text-gray-800', label: '終了' },
} as const;

// Session kinds (4 fixed options)
export type SessionKind =
  | 'activity_command'
  | 'transport_coordination'
  | 'info_analysis'
  | 'logistics_support'
  | 'extra';

export const SESSION_KIND_OPTIONS: Array<{ value: SessionKind | ''; label: string }> = [
  { value: '', label: '選択してください' },
  { value: 'activity_command', label: '活動指揮' },
  { value: 'transport_coordination', label: '搬送調整' },
  { value: 'info_analysis', label: '情報分析' },
  { value: 'logistics_support', label: '物資支援' },
] as const;

// Form data types
export interface CreateSessionFormData {
  session_kind: SessionKind | '';
  incident_name: string;
  zoom_meeting_id?: string;
}

export interface ZoomCredentialsFormData {
  client_id: string;
  client_secret: string;
  account_id: string;
}

export interface HQFormData {
  hq_name: string;
  zoom_pattern: string;
}

// Component prop types
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface BadgeProps {
  className?: string;
  children: React.ReactNode;
}
