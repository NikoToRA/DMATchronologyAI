import type { ChronologyEntry, Participant, Session } from './api';

// =============================================================================
// Type Definitions
// =============================================================================

/** WebSocket connection states */
export type WebSocketState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';

/** WebSocket message event types */
export type WebSocketEventType = 'new_entry' | 'participant_update' | 'session_update';

/** Typed message payloads for each event type */
export interface WebSocketEventPayloads {
  new_entry: ChronologyEntry;
  participant_update: Participant;
  session_update: Session;
}

/** WebSocket message structure with discriminated union */
export type WebSocketMessage<T extends WebSocketEventType = WebSocketEventType> = {
  type: T;
  data: WebSocketEventPayloads[T];
};

/** Type-safe message handler */
export type MessageHandler<T extends WebSocketEventType> = (data: WebSocketEventPayloads[T]) => void;

/** Generic message handler for untyped access */
export type GenericMessageHandler = (data: unknown) => void;

/** WebSocket client configuration options */
export interface WebSocketClientOptions {
  /** Maximum number of reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnection attempts in ms (default: 1000) */
  reconnectDelay?: number;
  /** Enable debug logging (default: false in production) */
  debug?: boolean;
}

/** WebSocket state change callback */
export type StateChangeCallback = (state: WebSocketState) => void;

// =============================================================================
// WebSocket Client Class
// =============================================================================

/**
 * Type-safe WebSocket client with automatic reconnection
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers: Map<WebSocketEventType, Set<GenericMessageHandler>> = new Map();
  private readonly stateChangeCallbacks: Set<StateChangeCallback> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _state: WebSocketState = 'disconnected';
  private intentionalDisconnect = false;

  // Configuration
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private readonly debug: boolean;

  constructor(sessionId?: string, options: WebSocketClientOptions = {}) {
    // Apply configuration with defaults
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.debug = options.debug ?? process.env.NODE_ENV === 'development';

    // Build WebSocket URL from API URL
    const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Derive WS host from API URL or use explicit WS URL
    let wsHost = process.env.NEXT_PUBLIC_WS_URL || 'localhost:8000';
    if (!process.env.NEXT_PUBLIC_WS_URL && process.env.NEXT_PUBLIC_API_URL) {
      try {
        const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL);
        wsHost = apiUrl.host;
      } catch {
        // Keep default
      }
    }

    this.url = sessionId
      ? `${wsProtocol}//${wsHost}/ws/${sessionId}`
      : `${wsProtocol}//${wsHost}/ws`;
  }

  // =============================================================================
  // Public Properties
  // =============================================================================

  /** Current connection state */
  get state(): WebSocketState {
    return this._state;
  }

  /** Whether the client is currently connected */
  get isConnected(): boolean {
    return this._state === 'connected';
  }

  /** Number of reconnection attempts made */
  get currentReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  // =============================================================================
  // Connection Management
  // =============================================================================

  /**
   * Establish WebSocket connection
   */
  connect(): void {
    // Skip on server-side
    if (typeof window === 'undefined') return;

    // Already connected or connecting
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionalDisconnect = false;
    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      this.log('error', 'Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimeout();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Force reconnect (useful for manual recovery)
   */
  reconnect(): void {
    this.disconnect();
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  /**
   * Subscribe to a specific event type with type-safe handler
   */
  on<T extends WebSocketEventType>(event: T, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as GenericMessageHandler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from a specific event type
   */
  off<T extends WebSocketEventType>(event: T, handler: MessageHandler<T>): void {
    this.handlers.get(event)?.delete(handler as GenericMessageHandler);
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.log('info', 'WebSocket connected');
      this.reconnectAttempts = 0;
      this.setState('connected');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.log('info', `WebSocket closed: code=${event.code}, reason=${event.reason}`);

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      this.log('error', 'WebSocket error:', event);
    };
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;

      if (!this.isValidMessageType(message.type)) {
        this.log('warn', `Unknown message type: ${message.type}`);
        return;
      }

      this.emit(message.type, message.data);
    } catch (error) {
      this.log('error', 'Failed to parse WebSocket message:', error);
    }
  }

  private isValidMessageType(type: string): type is WebSocketEventType {
    return ['new_entry', 'participant_update', 'session_update'].includes(type);
  }

  private emit(event: WebSocketEventType, data: unknown): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        this.log('error', `Error in handler for ${event}:`, error);
      }
    });
  }

  private setState(state: WebSocketState): void {
    if (this._state === state) return;

    this._state = state;
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        this.log('error', 'Error in state change callback:', error);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('warn', 'Max reconnect attempts reached');
      this.setState('failed');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const baseDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * 0.3 * baseDelay;
    const delay = Math.min(baseDelay + jitter, 30000); // Cap at 30 seconds

    this.log('info', `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    if (!this.debug && level === 'info') return;

    const prefix = `[WebSocket]`;
    switch (level) {
      case 'info':
        console.log(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/** Global WebSocket instance for session list updates */
let globalWsClient: WebSocketClient | null = null;

/**
 * Get or create the global WebSocket client
 * Used for session list updates and other global events
 */
export function getGlobalWebSocket(options?: WebSocketClientOptions): WebSocketClient {
  if (!globalWsClient) {
    globalWsClient = new WebSocketClient(undefined, options);
  }
  return globalWsClient;
}

/**
 * Reset the global WebSocket client
 * Useful for testing or when the connection needs to be recreated
 */
export function resetGlobalWebSocket(): void {
  if (globalWsClient) {
    globalWsClient.disconnect();
    globalWsClient = null;
  }
}

/**
 * Create a session-specific WebSocket client
 * Each session should have its own WebSocket connection
 */
export function createSessionWebSocket(sessionId: string, options?: WebSocketClientOptions): WebSocketClient {
  return new WebSocketClient(sessionId, options);
}
