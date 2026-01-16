/**
 * Custom React Hooks
 *
 * This module exports all custom hooks for the ChronologyAI application.
 * These hooks provide type-safe abstractions over API calls, WebSocket
 * connections, and state management.
 */

// =============================================================================
// Session Hooks
// =============================================================================

export {
  useSessionMutations,
  sessionMutationKeys,
  type UseSessionMutationsOptions,
  type UseSessionMutationsReturn,
} from './useSessionMutations';

export {
  useSession,
  useSessionList,
  useParticipantStats,
  useSessionActions,
  sessionQueryKeys,
  type UseSessionListReturn,
  type UseSessionReturn,
  type UseSessionOptions,
  type ParticipantStats,
} from './useSession';

// =============================================================================
// Participant Hooks
// =============================================================================

export {
  useParticipantMutations,
  participantQueryKeys,
  type UseParticipantMutationsOptions,
  type UseParticipantMutationsReturn,
} from './useParticipantMutations';

// =============================================================================
// Chronology Hooks
// =============================================================================

export {
  useChronology,
  useChronologyAutoScroll,
  useChronologyFilters,
  useCategoryStyle,
  chronologyQueryKeys,
  CHRONOLOGY_CATEGORIES,
  CATEGORY_STYLES,
  type UseChronologyReturn,
  type UseChronologyOptions,
  type UseChronologyAutoScrollOptions,
  type ChronologyFilters,
  type ChronologyStats,
} from './useChronology';

// =============================================================================
// WebSocket Hooks
// =============================================================================

export {
  useWebSocketConnection,
  useSessionDetailWebSocket,
  useChronologyWebSocket,
  type UseWebSocketConnectionOptions,
  type UseWebSocketConnectionReturn,
  type EventQueryConfig,
  type EventHandlers,
  type TypedEventHandler,
} from './useWebSocketConnection';
