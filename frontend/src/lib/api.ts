import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// Re-export shared types from types.ts for convenience
export type {
  SessionStatus,
  ConnectionStatus,
  IdentificationStatus,
  ChronologyCategory,
} from './types';

// Import types for internal use
import type {
  SessionStatus,
  ConnectionStatus,
  IdentificationStatus,
  ChronologyCategory,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// =============================================================================
// Type Definitions
// =============================================================================

/** Storage type for system configuration */
export type StorageType = 'azure' | 'local';

/** Session entity */
export interface Session {
  readonly session_id: string;
  title: string;
  session_kind?: 'activity_command' | 'transport_coordination' | 'info_analysis' | 'logistics_support' | 'extra';
  incident_name?: string | null;
  incident_date?: string | null;
  incident_id?: string | null;
  readonly start_at: string;
  readonly end_at: string | null;
  status: SessionStatus;
  zoom_meeting_id: string | null;
  readonly participant_count?: number;
  readonly entry_count?: number;
}

/** Participant entity */
export interface Participant {
  readonly participant_id: string;
  hq_id: string | null;
  readonly zoom_display_name: string;
  readonly join_at: string;
  readonly leave_at: string | null;
  is_declared: boolean;
  readonly connection_status: ConnectionStatus;
  readonly hq_name?: string | null;
  readonly identification_status?: IdentificationStatus;
  readonly last_speech_at?: string | null;
}

/** Chronology entry entity */
export interface ChronologyEntry {
  readonly entry_id: string;
  readonly segment_id: string;
  hq_id: string | null;
  readonly timestamp: string;
  category: ChronologyCategory;
  summary: string;
  text_raw: string;
  ai_note?: string | null;
  is_hq_confirmed: boolean;
  has_task?: boolean;
  readonly hq_name?: string | null;
}

/** HQ Master entity */
export interface HQMaster {
  readonly hq_id: string;
  hq_name: string;
  zoom_pattern: string;
  active: boolean;
  include_activity_command?: boolean;
  include_transport_coordination?: boolean;
  include_info_analysis?: boolean;
  include_logistics_support?: boolean;
}

export type IncidentStatus = 'active' | 'ended';

export interface Incident {
  readonly incident_id: string;
  incident_name: string;
  incident_date: string; // YYYY-MM-DD
  status: IncidentStatus;
  sessions: Record<string, string>;
  extra_sessions?: Array<{ label: string; session_id: string }>;
}

/** Zoom API credentials */
export interface ZoomCredentials {
  client_id: string;
  client_secret: string;
  account_id: string;
  readonly configured: boolean;
}

/** System status information */
export interface SystemStatus {
  readonly zoom_configured: boolean;
  readonly stt_configured: boolean;
  readonly openai_configured: boolean;
  readonly storage_type: StorageType;
}

/** LLM Settings */
export interface LLMSettings {
  system_prompt: string;
  temperature: number;
  max_tokens: number;
}

/** Dictionary entry for STT correction */
export interface DictionaryEntry {
  readonly entry_id: string;
  wrong_text: string;
  correct_text: string;
  active: boolean;
}

// =============================================================================
// Chat Types
// =============================================================================

/** Chat message role */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** Chat message entity */
export interface ChatMessage {
  readonly message_id: string;
  readonly thread_id: string;
  role: ChatMessageRole;
  content: string;
  readonly timestamp: string;
  readonly chronology_snapshot?: string[] | null;
}

/** Chat thread entity */
export interface ChatThread {
  readonly thread_id: string;
  readonly session_id: string;
  readonly creator_hq_id: string;
  readonly creator_hq_name: string;
  title: string;
  readonly created_at: string;
  readonly updated_at: string;
  messages: ChatMessage[];
}

/** Chat thread summary (for list view) */
export interface ChatThreadSummary {
  readonly thread_id: string;
  readonly session_id: string;
  readonly creator_hq_id: string;
  readonly creator_hq_name: string;
  title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly message_count: number;
  readonly can_write: boolean;
}

/** Chat thread creation payload */
export interface CreateChatThreadPayload {
  hq_id: string;
  hq_name: string;
  message: string;
  include_chronology?: boolean;
}

/** Chat message creation payload */
export interface SendChatMessagePayload {
  hq_id: string;
  message: string;
  include_chronology?: boolean;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/** Session creation payload */
export interface CreateSessionPayload {
  session_kind: 'activity_command' | 'transport_coordination' | 'info_analysis' | 'logistics_support';
  incident_name: string;
  zoom_meeting_id?: string;
}

/** Session update payload */
export type UpdateSessionPayload = Partial<Pick<Session, 'title' | 'session_kind' | 'incident_name' | 'zoom_meeting_id'>>;

/** Participant update payload */
export type UpdateParticipantPayload = Partial<Pick<Participant, 'hq_id' | 'is_declared'>>;

/** Chronology entry update payload */
export type UpdateChronologyPayload = Partial<
  Pick<ChronologyEntry, 'category' | 'summary' | 'text_raw' | 'ai_note' | 'is_hq_confirmed' | 'hq_id' | 'has_task'>
>;

/** Chronology list query parameters */
export interface ChronologyListParams {
  category?: ChronologyCategory | string;
  hq_id?: string;
  unconfirmed_only?: boolean;
}

/** HQ Master creation payload */
export interface CreateHQPayload {
  hq_name: string;
  zoom_pattern: string;
}

/** HQ Master update payload */
export type UpdateHQPayload = Partial<Pick<HQMaster, 'hq_name' | 'zoom_pattern' | 'active'>>;

/** Zoom credentials update payload */
export type UpdateZoomCredentialsPayload = Partial<Pick<ZoomCredentials, 'client_id' | 'client_secret' | 'account_id'>>;

// =============================================================================
// Error Types
// =============================================================================

/** Structured API error */
export interface ApiErrorResponse {
  message?: string;
  // FastAPI validation errors commonly return { detail: [...] } or { detail: "..." }
  detail?: unknown;
  code?: string;
  details?: Record<string, unknown>;
}

/** Custom API error class */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromAxiosError(error: AxiosError<ApiErrorResponse>): ApiError {
    const response = error.response;
    if (response) {
      const data = response.data;
      // Try to extract meaningful message from FastAPI-style errors
      let message: string | undefined = data?.message;
      if (!message && data && typeof (data as any).detail !== 'undefined') {
        const detail = (data as any).detail;
        if (typeof detail === 'string') {
          message = detail;
        } else if (Array.isArray(detail)) {
          // Typical shape: [{ loc: [...], msg: "...", type: "..." }, ...]
          const parts = detail
            .map((d: any) => {
              const loc = Array.isArray(d?.loc) ? d.loc.join('.') : d?.loc;
              const msg = d?.msg ?? JSON.stringify(d);
              return loc ? `${loc}: ${msg}` : String(msg);
            })
            .filter(Boolean);
          message = parts.join(' / ');
        } else if (detail && typeof detail === 'object') {
          message = JSON.stringify(detail);
        }
      }
      return new ApiError(
        message || error.message || 'Unknown error',
        response.status,
        data?.code,
        data?.details
      );
    }
    return new ApiError(error.message || 'Network error', 0);
  }

  /** Check if error is a client error (4xx) */
  get isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /** Check if error is a server error (5xx) */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /** Check if error is a network error */
  get isNetworkError(): boolean {
    return this.statusCode === 0;
  }
}

// =============================================================================
// Axios Instance Configuration
// =============================================================================

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor for logging and authentication
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Add request timestamp for performance tracking
    config.headers.set('X-Request-Time', Date.now().toString());
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError<ApiErrorResponse>) => {
    const apiError = ApiError.fromAxiosError(error);

    // Log error for debugging (can be replaced with proper logging service)
    if (process.env.NODE_ENV === 'development') {
      console.error('[API Error]', {
        url: error.config?.url,
        method: error.config?.method,
        status: apiError.statusCode,
        message: apiError.message,
      });
    }

    return Promise.reject(apiError);
  }
)

// =============================================================================
// API Service Objects
// =============================================================================

/**
 * Sessions API service
 * Handles all session-related API calls
 */
export const sessionsApi = {
  /** List all sessions */
  list: () => api.get<Session[]>('/api/sessions'),

  /** Get a single session by ID */
  get: (id: string) => api.get<Session>(`/api/sessions/${id}`),

  /** Create a new session */
  create: (data: CreateSessionPayload) =>
    api.post<Session>('/api/sessions', data),

  /** Update an existing session */
  update: (id: string, data: UpdateSessionPayload) =>
    api.patch<Session>(`/api/sessions/${id}`, data),

  /** Start a session */
  start: (id: string) => api.post<Session>(`/api/sessions/${id}/start`),

  /** End a session */
  end: (id: string) => api.post<Session>(`/api/sessions/${id}/end`),
} as const;

/**
 * Participants API service
 * Handles all participant-related API calls
 */
export const participantsApi = {
  /** List all participants in a session */
  list: (sessionId: string) =>
    api.get<Participant[]>(`/api/sessions/${sessionId}/participants`),

  /** Add a participant to a session */
  create: (sessionId: string, data: { zoom_display_name: string; hq_id?: string }) =>
    api.post<Participant>(`/api/sessions/${sessionId}/participants`, data),

  /** Update a participant's information */
  update: (sessionId: string, participantId: string, data: UpdateParticipantPayload) =>
    api.patch<Participant>(`/api/sessions/${sessionId}/participants/${participantId}`, data),
} as const;

/**
 * Chronology API service
 * Handles all chronology entry-related API calls
 */
export const chronologyApi = {
  /** List chronology entries with optional filters */
  list: (sessionId: string, params?: ChronologyListParams) =>
    api.get<ChronologyEntry[]>(`/api/sessions/${sessionId}/chronology`, { params }),

  /**
   * Create a manual chronology entry.
   * NOTE: backend expects JSON body (ChronologyCreate), not query params.
   */
  create: (
    sessionId: string,
    data: { text_raw: string; participant_id?: string; timestamp?: string }
  ) => api.post<ChronologyEntry>(`/api/sessions/${sessionId}/chronology`, data),

  /** Update a chronology entry */
  update: (sessionId: string, entryId: string, data: UpdateChronologyPayload) =>
    api.patch<ChronologyEntry>(`/api/sessions/${sessionId}/chronology/${entryId}`, data),

  /** Delete a chronology entry */
  delete: (sessionId: string, entryId: string) =>
    api.delete<void>(`/api/sessions/${sessionId}/chronology/${entryId}`),
} as const;

/**
 * Settings API service
 * Handles system configuration API calls
 */
export const settingsApi = {
  /** Get Zoom API credentials */
  getZoomCredentials: () => api.get<ZoomCredentials>('/api/settings/zoom'),

  /** Update Zoom API credentials */
  updateZoomCredentials: (data: UpdateZoomCredentialsPayload) =>
    api.put<ZoomCredentials>('/api/settings/zoom', data),

  /** Get HQ master list */
  getHQMaster: () => api.get<HQMaster[]>('/api/settings/hq'),

  /** Create a new HQ entry */
  createHQ: (data: CreateHQPayload) =>
    api.post<HQMaster>('/api/settings/hq', data),

  /** Update an HQ entry */
  updateHQ: (id: string, data: UpdateHQPayload) =>
    api.patch<HQMaster>(`/api/settings/hq/${id}`, data),

  /** Delete an HQ entry */
  deleteHQ: (id: string) => api.delete<void>(`/api/settings/hq/${id}`),

  /** Get system status */
  getStatus: () => api.get<SystemStatus>('/api/settings/status'),

  /** Get LLM settings */
  getLLMSettings: () => api.get<LLMSettings>('/api/settings/llm'),

  /** Get default LLM prompt */
  getDefaultLLMPrompt: () => api.get<{ default_prompt: string }>('/api/settings/llm/default-prompt'),

  /** Update LLM settings */
  updateLLMSettings: (data: Partial<LLMSettings>) =>
    api.put<LLMSettings>('/api/settings/llm', data),

  /** Get dictionary entries */
  getDictionary: () => api.get<DictionaryEntry[]>('/api/settings/dictionary'),

  /** Create dictionary entry */
  createDictionaryEntry: (data: { wrong_text: string; correct_text: string; active?: boolean }) =>
    api.post<DictionaryEntry>('/api/settings/dictionary', data),

  /** Update dictionary entry */
  updateDictionaryEntry: (id: string, data: Partial<Pick<DictionaryEntry, 'wrong_text' | 'correct_text' | 'active'>>) =>
    api.patch<DictionaryEntry>(`/api/settings/dictionary/${id}`, data),

  /** Delete dictionary entry */
  deleteDictionaryEntry: (id: string) => api.delete<void>(`/api/settings/dictionary/${id}`),
} as const;

/**
 * Session HQ master API service
 * HQ master differs per session in real operations.
 */
export const sessionHqApi = {
  /** List HQ master for a session */
  list: (sessionId: string) => api.get<HQMaster[]>(`/api/sessions/${sessionId}/hq`),

  /** Create a new HQ entry for a session */
  create: (sessionId: string, data: CreateHQPayload) =>
    api.post<HQMaster>(`/api/sessions/${sessionId}/hq`, data),

  /** Update an HQ entry for a session */
  update: (sessionId: string, id: string, data: UpdateHQPayload) =>
    api.patch<HQMaster>(`/api/sessions/${sessionId}/hq/${id}`, data),

  /** Delete an HQ entry for a session */
  delete: (sessionId: string, id: string) => api.delete<void>(`/api/sessions/${sessionId}/hq/${id}`),
} as const;

export const incidentsApi = {
  list: () => api.get<Incident[]>('/api/incidents'),
  get: (incidentId: string) => api.get<Incident>(`/api/incidents/${incidentId}`),
  create: (data: { incident_name: string; incident_date: string }) =>
    api.post<Incident>('/api/incidents', data),
  update: (incidentId: string, data: Partial<Pick<Incident, 'incident_name' | 'incident_date' | 'status'>>) =>
    api.patch<Incident>(`/api/incidents/${incidentId}`, data),
  delete: (incidentId: string) => api.delete<{ message: string }>(`/api/incidents/${incidentId}`),
  addExtraSession: (incidentId: string, data: { label: string; zoom_meeting_id?: string }) =>
    api.post<Incident>(`/api/incidents/${incidentId}/extra_sessions`, data),
  ensureDepartmentSessions: (incidentId: string) =>
    api.post<Incident>(`/api/incidents/${incidentId}/ensure_department_sessions`),
} as const;

/**
 * Zoom API service
 * Handles Zoom meeting integration
 */
export const zoomApi = {
  /** Join a Zoom meeting for a session */
  join: (sessionId: string, meetingId: string) =>
    api.post<void>(`/api/zoom/join/${sessionId}`, null, { params: { meeting_id: meetingId } }),

  /** Leave a Zoom meeting for a session */
  leave: (sessionId: string) => api.post<void>(`/api/zoom/leave/${sessionId}`),
} as const;

/**
 * Chat API service
 * Handles AI chat functionality
 */
export const chatApi = {
  /** List chat threads for a session */
  listThreads: (sessionId: string, hqId: string) =>
    api.get<ChatThreadSummary[]>(`/api/sessions/${sessionId}/chat/threads`, {
      params: { hq_id: hqId },
    }),

  /** Get a specific thread with messages */
  getThread: (sessionId: string, threadId: string, hqId: string) =>
    api.get<{ thread: ChatThread; can_write: boolean }>(
      `/api/sessions/${sessionId}/chat/threads/${threadId}`,
      { params: { hq_id: hqId } }
    ),

  /** Create a new chat thread */
  createThread: (sessionId: string, data: CreateChatThreadPayload) =>
    api.post<{
      thread: {
        id: string;
        creator_hq_id: string;
        creator_hq_name: string;
        title: string;
        can_write: boolean;
      };
      message: {
        id: string;
        role: string;
        content: string;
        timestamp: string;
      };
    }>(`/api/sessions/${sessionId}/chat/threads`, data),

  /** Send a message to a thread */
  sendMessage: (sessionId: string, threadId: string, data: SendChatMessagePayload) =>
    api.post<{
      message: {
        id: string;
        role: string;
        content: string;
        timestamp: string;
      };
    }>(`/api/sessions/${sessionId}/chat/threads/${threadId}/messages`, data),
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
}
