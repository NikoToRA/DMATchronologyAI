'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import {
  sessionsApi,
  participantsApi,
  sessionHqApi,
  zoomApi,
  Session,
  Participant,
  HQMaster,
  CreateSessionPayload,
  UpdateSessionPayload,
  UpdateParticipantPayload,
  ApiError,
  getErrorMessage,
} from '@/lib/api';
import { createSessionWebSocket, WebSocketClient, WebSocketState } from '@/lib/websocket';

// =============================================================================
// Query Keys
// =============================================================================

/** Centralized query keys for consistent cache management */
export const sessionQueryKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionQueryKeys.all, 'list'] as const,
  list: () => [...sessionQueryKeys.lists()] as const,
  details: () => [...sessionQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...sessionQueryKeys.details(), id] as const,
  participants: (sessionId: string) => [...sessionQueryKeys.detail(sessionId), 'participants'] as const,
  hqMaster: (sessionId: string) => [...sessionQueryKeys.detail(sessionId), 'hqMaster'] as const,
} as const;

// =============================================================================
// Types
// =============================================================================

/** Session list hook return type */
export interface UseSessionListReturn {
  sessions: Session[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
  createSession: (data: CreateSessionPayload) => void;
  isCreating: boolean;
  createError: ApiError | null;
}

/** Single session hook return type */
export interface UseSessionReturn {
  session: Session | undefined;
  participants: Participant[] | undefined;
  hqMaster: HQMaster[] | undefined;
  isLoading: boolean;
  isSessionLoading: boolean;
  isParticipantsLoading: boolean;
  isError: boolean;
  error: ApiError | null;
  wsState: WebSocketState;
  // Actions
  startSession: () => void;
  endSession: () => void;
  updateParticipant: (participantId: string, data: UpdateParticipantPayload) => void;
  joinZoom: (meetingId: string) => void;
  leaveZoom: () => void;
  refetch: () => void;
  // Mutation states
  isStarting: boolean;
  isEnding: boolean;
  isUpdatingParticipant: boolean;
  isJoiningZoom: boolean;
}

/** Participant stats */
export interface ParticipantStats {
  total: number;
  confirmed: number;
  unconfirmed: number;
  active: number;
}

// =============================================================================
// useSessionList Hook
// =============================================================================

/**
 * Hook for managing the session list
 * Provides session listing, creation, and real-time updates
 */
export function useSessionList(): UseSessionListReturn {
  const queryClient = useQueryClient();

  // Fetch sessions
  const {
    data: sessions,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: sessionQueryKeys.list(),
    queryFn: async () => {
      const response = await sessionsApi.list();
      return response.data;
    },
  });

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: sessionsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.lists() });
    },
  });

  return {
    sessions,
    isLoading,
    isError,
    error: error as ApiError | null,
    refetch,
    createSession: createMutation.mutate,
    isCreating: createMutation.isPending,
    createError: createMutation.error as ApiError | null,
  };
}

// =============================================================================
// useSession Hook
// =============================================================================

/** Options for useSession hook */
export interface UseSessionOptions {
  /** Enable WebSocket real-time updates (default: true) */
  enableWebSocket?: boolean;
  /** Session data query options */
  queryOptions?: Partial<UseQueryOptions<Session>>;
}

/**
 * Hook for managing a single session with participants
 * Includes WebSocket integration for real-time updates
 */
export function useSession(sessionId: string, options: UseSessionOptions = {}): UseSessionReturn {
  const { enableWebSocket = true } = options;
  const queryClient = useQueryClient();

  // Track WebSocket state
  const wsStateRef = { current: 'disconnected' as WebSocketState };

  // Fetch session
  const sessionQuery = useQuery({
    queryKey: sessionQueryKeys.detail(sessionId),
    queryFn: async () => {
      const response = await sessionsApi.get(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
  });

  // Fetch participants
  const participantsQuery = useQuery({
    queryKey: sessionQueryKeys.participants(sessionId),
    queryFn: async () => {
      const response = await participantsApi.list(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
  });

  // Fetch HQ master
  const hqMasterQuery = useQuery({
    queryKey: sessionQueryKeys.hqMaster(sessionId),
    queryFn: async () => {
      const response = await sessionHqApi.list(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
  });

  // Mutations
  const startMutation = useMutation({
    mutationFn: () => sessionsApi.start(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    },
  });

  const endMutation = useMutation({
    mutationFn: () => sessionsApi.end(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    },
  });

  const updateParticipantMutation = useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: UpdateParticipantPayload }) =>
      participantsApi.update(sessionId, participantId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.participants(sessionId) });
    },
  });

  const joinZoomMutation = useMutation({
    mutationFn: (meetingId: string) => zoomApi.join(sessionId, meetingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    },
  });

  const leaveZoomMutation = useMutation({
    mutationFn: () => zoomApi.leave(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    },
  });

  // WebSocket connection
  useEffect(() => {
    if (!enableWebSocket || !sessionId) return;

    const ws = createSessionWebSocket(sessionId);
    ws.connect();

    // Track state changes
    const unsubscribeState = ws.onStateChange((state) => {
      wsStateRef.current = state;
    });

    // Subscribe to events
    const unsubscribeParticipant = ws.on('participant_update', () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.participants(sessionId) });
    });

    const unsubscribeSession = ws.on('session_update', () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    });

    return () => {
      unsubscribeState();
      unsubscribeParticipant();
      unsubscribeSession();
      ws.disconnect();
    };
  }, [sessionId, queryClient, enableWebSocket]);

  // Callbacks
  const updateParticipant = useCallback(
    (participantId: string, data: UpdateParticipantPayload) => {
      updateParticipantMutation.mutate({ participantId, data });
    },
    [updateParticipantMutation]
  );

  const refetch = useCallback(() => {
    sessionQuery.refetch();
    participantsQuery.refetch();
  }, [sessionQuery, participantsQuery]);

  return {
    session: sessionQuery.data,
    participants: participantsQuery.data,
    hqMaster: hqMasterQuery.data,
    isLoading: sessionQuery.isLoading || participantsQuery.isLoading,
    isSessionLoading: sessionQuery.isLoading,
    isParticipantsLoading: participantsQuery.isLoading,
    isError: sessionQuery.isError || participantsQuery.isError,
    error: (sessionQuery.error || participantsQuery.error) as ApiError | null,
    wsState: wsStateRef.current,
    // Actions
    startSession: startMutation.mutate,
    endSession: endMutation.mutate,
    updateParticipant,
    joinZoom: joinZoomMutation.mutate,
    leaveZoom: leaveZoomMutation.mutate,
    refetch,
    // Mutation states
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
    isUpdatingParticipant: updateParticipantMutation.isPending,
    isJoiningZoom: joinZoomMutation.isPending,
  };
}

// =============================================================================
// useParticipantStats Hook
// =============================================================================

/**
 * Compute participant statistics from a participant list
 */
export function useParticipantStats(participants: Participant[] | undefined): ParticipantStats {
  return useMemo(() => {
    if (!participants) {
      return { total: 0, confirmed: 0, unconfirmed: 0, active: 0 };
    }

    return {
      total: participants.length,
      confirmed: participants.filter((p) => p.identification_status === '確定').length,
      unconfirmed: participants.filter((p) => p.identification_status === '未確定').length,
      active: participants.filter((p) => p.connection_status === '参加中').length,
    };
  }, [participants]);
}

// =============================================================================
// useSessionActions Hook
// =============================================================================

/**
 * Hook for session lifecycle actions (start, end, etc.)
 * Useful when you only need actions without the full session data
 */
export function useSessionActions(sessionId: string) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => sessionsApi.start(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.lists() });
    },
  });

  const endMutation = useMutation({
    mutationFn: () => sessionsApi.end(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.lists() });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateSessionPayload) => sessionsApi.update(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.lists() });
    },
  });

  return {
    start: startMutation.mutate,
    end: endMutation.mutate,
    update: updateMutation.mutate,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
    isUpdating: updateMutation.isPending,
    startError: startMutation.error as ApiError | null,
    endError: endMutation.error as ApiError | null,
    updateError: updateMutation.error as ApiError | null,
  };
}
