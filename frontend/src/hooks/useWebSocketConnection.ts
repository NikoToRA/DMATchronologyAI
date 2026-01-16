'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient, QueryKey } from '@tanstack/react-query';
import {
  createSessionWebSocket,
  WebSocketClient,
  WebSocketState,
  WebSocketEventType,
  WebSocketEventPayloads,
} from '@/lib/websocket';

// =============================================================================
// Types
// =============================================================================

/** Event handler type with typed payload */
export type TypedEventHandler<T extends WebSocketEventType> = (
  data: WebSocketEventPayloads[T]
) => void;

/** Event configuration for query invalidation */
export type EventQueryConfig = Partial<Record<WebSocketEventType, QueryKey[]>>;

/** Custom event handlers with typed payloads */
export type EventHandlers = {
  [K in WebSocketEventType]?: TypedEventHandler<K>;
};

/** Options for useWebSocketConnection hook */
export interface UseWebSocketConnectionOptions {
  /** Session ID to connect to */
  sessionId: string;
  /** Events to listen for and their corresponding query keys to invalidate */
  events?: EventQueryConfig;
  /** Custom event handlers with typed payloads */
  handlers?: EventHandlers;
  /** Generic event handler for all events */
  onEvent?: (event: WebSocketEventType, data: unknown) => void;
  /** Callback when connection state changes */
  onStateChange?: (state: WebSocketState) => void;
  /** Whether to automatically connect on mount (default: true) */
  autoConnect?: boolean;
}

/** Return type of useWebSocketConnection hook */
export interface UseWebSocketConnectionReturn {
  /** WebSocket client instance (null if not connected) */
  ws: WebSocketClient | null;
  /** Current connection state */
  state: WebSocketState;
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Whether the WebSocket is reconnecting */
  isReconnecting: boolean;
  /** Whether the WebSocket connection failed */
  isFailed: boolean;
  /** Manually connect the WebSocket */
  connect: () => void;
  /** Manually disconnect the WebSocket */
  disconnect: () => void;
  /** Force reconnect the WebSocket */
  reconnect: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Custom hook for managing WebSocket connections with automatic cleanup.
 * Automatically invalidates queries when events are received.
 *
 * @example
 * ```tsx
 * const { state, isConnected } = useWebSocketConnection({
 *   sessionId,
 *   events: {
 *     new_entry: [['chronology', sessionId]],
 *     participant_update: [['participants', sessionId]],
 *   },
 *   handlers: {
 *     new_entry: (entry) => console.log('New entry:', entry),
 *   },
 * });
 * ```
 */
export function useWebSocketConnection({
  sessionId,
  events = {},
  handlers = {},
  onEvent,
  onStateChange,
  autoConnect = true,
}: UseWebSocketConnectionOptions): UseWebSocketConnectionReturn {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocketClient | null>(null);
  const [state, setState] = useState<WebSocketState>('disconnected');

  // Store handlers in refs to avoid recreating event handlers
  const handlersRef = useRef(handlers);
  const onEventRef = useRef(onEvent);
  const eventsRef = useRef(events);

  // Update refs when props change
  useEffect(() => {
    handlersRef.current = handlers;
    onEventRef.current = onEvent;
    eventsRef.current = events;
  }, [handlers, onEvent, events]);

  // Handle incoming WebSocket events
  const createEventHandler = useCallback(
    <T extends WebSocketEventType>(event: T) =>
      (data: WebSocketEventPayloads[T]) => {
        // Invalidate configured query keys
        const queryKeys = eventsRef.current[event];
        if (queryKeys) {
          queryKeys.forEach((queryKey) => {
            queryClient.invalidateQueries({ queryKey });
          });
        }

        // Call typed handler if provided
        const handler = handlersRef.current[event] as TypedEventHandler<T> | undefined;
        if (handler) {
          handler(data);
        }

        // Call generic handler if provided
        onEventRef.current?.(event, data);
      },
    [queryClient]
  );

  // Manual connection controls
  const connect = useCallback(() => {
    wsRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    wsRef.current?.reconnect();
  }, []);

  useEffect(() => {
    // Create WebSocket connection
    const ws = createSessionWebSocket(sessionId);
    wsRef.current = ws;

    // Subscribe to state changes
    const unsubscribeState = ws.onStateChange((newState) => {
      setState(newState);
      onStateChange?.(newState);
    });

    // Register event listeners
    const eventTypes: WebSocketEventType[] = ['new_entry', 'participant_update', 'session_update'];
    const unsubscribers = eventTypes.map((event) =>
      ws.on(event, createEventHandler(event))
    );

    // Connect if autoConnect is enabled
    if (autoConnect) {
      ws.connect();
    }

    // Cleanup on unmount
    return () => {
      unsubscribeState();
      unsubscribers.forEach((unsub) => unsub());
      ws.disconnect();
      wsRef.current = null;
    };
  }, [sessionId, createEventHandler, autoConnect, onStateChange]);

  return {
    ws: wsRef.current,
    state,
    isConnected: state === 'connected',
    isReconnecting: state === 'reconnecting',
    isFailed: state === 'failed',
    connect,
    disconnect,
    reconnect,
  };
}

// =============================================================================
// Preset Hooks
// =============================================================================

/**
 * Preset configuration for session detail page WebSocket events.
 * Automatically invalidates participant and session queries on updates.
 *
 * @example
 * ```tsx
 * const { isConnected, state } = useSessionDetailWebSocket(sessionId);
 * ```
 */
export function useSessionDetailWebSocket(
  sessionId: string,
  options?: Omit<UseWebSocketConnectionOptions, 'sessionId' | 'events'>
): UseWebSocketConnectionReturn {
  return useWebSocketConnection({
    ...options,
    sessionId,
    events: {
      participant_update: [['participants', sessionId]],
      session_update: [['session', sessionId]],
    },
  });
}

/**
 * Preset configuration for chronology page WebSocket events.
 * Automatically invalidates chronology queries on new entries.
 *
 * @example
 * ```tsx
 * const { isConnected, state } = useChronologyWebSocket(sessionId);
 * ```
 */
export function useChronologyWebSocket(
  sessionId: string,
  options?: Omit<UseWebSocketConnectionOptions, 'sessionId' | 'events'>
): UseWebSocketConnectionReturn {
  return useWebSocketConnection({
    ...options,
    sessionId,
    events: {
      new_entry: [['chronology', sessionId]],
    },
  });
}
