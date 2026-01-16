'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  sessionsApi,
  CreateSessionPayload,
  UpdateSessionPayload,
  ApiError,
  isApiError,
  Session,
} from '@/lib/api';
import type { CreateSessionFormData } from '@/lib/types';

// =============================================================================
// Types
// =============================================================================

/** Options for useSessionMutations hook */
export interface UseSessionMutationsOptions {
  /** Session ID for session-specific operations */
  sessionId?: string;
  /** Callback when session is created successfully */
  onCreateSuccess?: (session: Session) => void;
  /** Callback when session starts successfully */
  onStartSuccess?: (session: Session) => void;
  /** Callback when session ends successfully */
  onEndSuccess?: (session: Session) => void;
  /** Callback when session is updated successfully */
  onUpdateSuccess?: (session: Session) => void;
  /** Callback for any mutation error */
  onError?: (error: ApiError) => void;
}

/** Return type of useSessionMutations hook */
export interface UseSessionMutationsReturn {
  /** Create a new session */
  create: (data: CreateSessionPayload | CreateSessionFormData) => void;
  /** Start a session (uses sessionId from options if id not provided) */
  start: (id?: string) => void;
  /** End a session (uses sessionId from options if id not provided) */
  end: (id?: string) => void;
  /** Update a session (uses sessionId from options if id not provided) */
  update: (data: UpdateSessionPayload, id?: string) => void;
  /** Loading states */
  isCreating: boolean;
  isStarting: boolean;
  isEnding: boolean;
  isUpdating: boolean;
  /** Whether any mutation is in progress */
  isLoading: boolean;
  /** Error states */
  createError: ApiError | null;
  startError: ApiError | null;
  endError: ApiError | null;
  updateError: ApiError | null;
}

// =============================================================================
// Query Keys
// =============================================================================

/** Session-related query keys for cache invalidation */
export const sessionMutationKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionMutationKeys.all, 'list'] as const,
  detail: (id: string) => ['session', id] as const,
} as const;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Custom hook for session-related mutations.
 * Provides create, start, end, and update mutations with automatic cache invalidation.
 *
 * @example
 * ```tsx
 * const { create, start, end, isCreating, isStarting } = useSessionMutations({
 *   sessionId: currentSessionId,
 *   onCreateSuccess: (session) => router.push(`/sessions/${session.session_id}`),
 * });
 * ```
 */
export function useSessionMutations(
  options: UseSessionMutationsOptions = {}
): UseSessionMutationsReturn {
  const {
    sessionId,
    onCreateSuccess,
    onStartSuccess,
    onEndSuccess,
    onUpdateSuccess,
    onError,
  } = options;

  const queryClient = useQueryClient();

  // Helper to handle errors consistently
  const handleError = useCallback(
    (error: unknown) => {
      if (isApiError(error) && onError) {
        onError(error);
      }
    },
    [onError]
  );

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateSessionPayload) => sessionsApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: sessionMutationKeys.lists() });
      onCreateSuccess?.(response.data);
    },
    onError: handleError,
  });

  // Start session mutation
  const startMutation = useMutation({
    mutationFn: (id?: string) => {
      const targetId = id ?? sessionId;
      if (!targetId) {
        return Promise.reject(new Error('Session ID is required to start a session'));
      }
      return sessionsApi.start(targetId);
    },
    onSuccess: (response, targetId) => {
      const id = targetId ?? sessionId;
      queryClient.invalidateQueries({ queryKey: sessionMutationKeys.lists() });
      if (id) {
        queryClient.invalidateQueries({ queryKey: sessionMutationKeys.detail(id) });
      }
      onStartSuccess?.(response.data);
    },
    onError: handleError,
  });

  // End session mutation
  const endMutation = useMutation({
    mutationFn: (id?: string) => {
      const targetId = id ?? sessionId;
      if (!targetId) {
        return Promise.reject(new Error('Session ID is required to end a session'));
      }
      return sessionsApi.end(targetId);
    },
    onSuccess: (response, targetId) => {
      const id = targetId ?? sessionId;
      queryClient.invalidateQueries({ queryKey: sessionMutationKeys.lists() });
      if (id) {
        queryClient.invalidateQueries({ queryKey: sessionMutationKeys.detail(id) });
      }
      onEndSuccess?.(response.data);
    },
    onError: handleError,
  });

  // Update session mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSessionPayload }) =>
      sessionsApi.update(id, data),
    onSuccess: (response, { id }) => {
      queryClient.invalidateQueries({ queryKey: sessionMutationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sessionMutationKeys.detail(id) });
      onUpdateSuccess?.(response.data);
    },
    onError: handleError,
  });

  // Convenience wrappers
  const create = useCallback(
    (data: CreateSessionPayload | CreateSessionFormData) => {
      createMutation.mutate(data as CreateSessionPayload);
    },
    [createMutation]
  );

  const start = useCallback(
    (id?: string) => {
      startMutation.mutate(id);
    },
    [startMutation]
  );

  const end = useCallback(
    (id?: string) => {
      endMutation.mutate(id);
    },
    [endMutation]
  );

  const update = useCallback(
    (data: UpdateSessionPayload, id?: string) => {
      const targetId = id ?? sessionId;
      if (!targetId) {
        console.error('Session ID is required to update a session');
        return;
      }
      updateMutation.mutate({ id: targetId, data });
    },
    [updateMutation, sessionId]
  );

  return {
    create,
    start,
    end,
    update,
    isCreating: createMutation.isPending,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
    isUpdating: updateMutation.isPending,
    isLoading:
      createMutation.isPending ||
      startMutation.isPending ||
      endMutation.isPending ||
      updateMutation.isPending,
    createError: createMutation.error as ApiError | null,
    startError: startMutation.error as ApiError | null,
    endError: endMutation.error as ApiError | null,
    updateError: updateMutation.error as ApiError | null,
  };
}
