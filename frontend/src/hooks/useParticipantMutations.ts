'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  participantsApi,
  UpdateParticipantPayload,
  Participant,
  ApiError,
  isApiError,
} from '@/lib/api';

// =============================================================================
// Types
// =============================================================================

/** Options for useParticipantMutations hook */
export interface UseParticipantMutationsOptions {
  /** Session ID for participant operations */
  sessionId: string;
  /** Callback when participant is updated successfully */
  onUpdateSuccess?: (participant: Participant) => void;
  /** Callback for any mutation error */
  onError?: (error: ApiError) => void;
}

/** Return type of useParticipantMutations hook */
export interface UseParticipantMutationsReturn {
  /** Update a participant */
  update: (participantId: string, data: UpdateParticipantPayload) => void;
  /** Whether update is in progress */
  isUpdating: boolean;
  /** Update error */
  updateError: ApiError | null;
}

// =============================================================================
// Query Keys
// =============================================================================

/** Participant-related query keys for cache invalidation */
export const participantQueryKeys = {
  all: ['participants'] as const,
  list: (sessionId: string) => [...participantQueryKeys.all, sessionId] as const,
  detail: (sessionId: string, participantId: string) =>
    [...participantQueryKeys.list(sessionId), participantId] as const,
} as const;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Custom hook for participant-related mutations.
 * Provides update mutation with automatic cache invalidation.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, updateError } = useParticipantMutations({
 *   sessionId,
 *   onUpdateSuccess: () => setEditingParticipant(null),
 * });
 *
 * // Update a participant's HQ assignment
 * update(participantId, { hq_id: selectedHqId });
 * ```
 */
export function useParticipantMutations({
  sessionId,
  onUpdateSuccess,
  onError,
}: UseParticipantMutationsOptions): UseParticipantMutationsReturn {
  const queryClient = useQueryClient();

  // Handle errors consistently
  const handleError = useCallback(
    (error: unknown) => {
      if (isApiError(error) && onError) {
        onError(error);
      }
    },
    [onError]
  );

  const updateMutation = useMutation({
    mutationFn: ({
      participantId,
      data,
    }: {
      participantId: string;
      data: UpdateParticipantPayload;
    }) => participantsApi.update(sessionId, participantId, data),
    onSuccess: (response) => {
      // Invalidate participant list for this session
      queryClient.invalidateQueries({
        queryKey: participantQueryKeys.list(sessionId),
      });
      onUpdateSuccess?.(response.data);
    },
    onError: handleError,
  });

  // Convenience wrapper
  const update = useCallback(
    (participantId: string, data: UpdateParticipantPayload) => {
      updateMutation.mutate({ participantId, data });
    },
    [updateMutation]
  );

  return {
    update,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error as ApiError | null,
  };
}
