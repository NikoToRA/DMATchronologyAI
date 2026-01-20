'use client';

import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  chronologyApi,
  participantsApi,
  sessionsApi,
  sessionHqApi,
  ChronologyEntry,
  ChronologyCategory,
  ChronologyListParams,
  UpdateChronologyPayload,
  HQMaster,
  Participant,
  Session,
  ApiError,
} from '@/lib/api';
import { createSessionWebSocket, WebSocketState } from '@/lib/websocket';

// =============================================================================
// Query Keys
// =============================================================================

/** Centralized query keys for chronology data */
export const chronologyQueryKeys = {
  all: ['chronology'] as const,
  lists: () => [...chronologyQueryKeys.all, 'list'] as const,
  list: (sessionId: string, params?: ChronologyListParams) =>
    [...chronologyQueryKeys.lists(), sessionId, params] as const,
  detail: (sessionId: string, entryId: string) =>
    [...chronologyQueryKeys.all, 'detail', sessionId, entryId] as const,
} as const;

// =============================================================================
// Constants
// =============================================================================

/** Available chronology categories with display labels */
export const CHRONOLOGY_CATEGORIES: ReadonlyArray<{ value: ChronologyCategory | ''; label: string }> = [
  { value: '', label: 'すべて' },
  { value: '指示', label: '指示' },
  { value: '依頼', label: '依頼' },
  { value: '報告', label: '報告' },
  { value: '決定', label: '決定' },
  { value: '確認', label: '確認' },
  { value: 'リスク', label: 'リスク' },
  { value: 'その他', label: 'その他' },
] as const;

/** Category styling configuration */
export const CATEGORY_STYLES: Readonly<Record<ChronologyCategory, string>> = {
  '指示': 'bg-red-100 text-red-800',
  '依頼': 'bg-yellow-100 text-yellow-800',
  '報告': 'bg-blue-100 text-blue-800',
  '決定': 'bg-green-100 text-green-800',
  '確認': 'bg-purple-100 text-purple-800',
  'リスク': 'bg-orange-100 text-orange-800',
  'その他': 'bg-gray-100 text-gray-800',
} as const;

// =============================================================================
// Types
// =============================================================================

/** Filter state for chronology entries */
export interface ChronologyFilters {
  category: ChronologyCategory | '';
  hqId: string;
  unconfirmedOnly: boolean;
}

/** Chronology hook return type */
export interface UseChronologyReturn {
  // Data
  entries: ChronologyEntry[] | undefined;
  session: Session | undefined;
  hqMaster: HQMaster[] | undefined;
  participants: Participant[] | undefined;
  // Loading states
  isLoading: boolean;
  isEntriesLoading: boolean;
  isSessionLoading: boolean;
  // Error states
  isError: boolean;
  error: ApiError | null;
  // Filters
  filters: ChronologyFilters;
  setFilters: (filters: Partial<ChronologyFilters>) => void;
  resetFilters: () => void;
  // Actions
  updateEntry: (entryId: string, data: UpdateChronologyPayload) => void;
  refetch: () => void;
  // Mutation states
  isUpdating: boolean;
  updateError: ApiError | null;
  // WebSocket
  wsState: WebSocketState;
  // Stats
  stats: ChronologyStats;
}

/** Chronology statistics */
export interface ChronologyStats {
  total: number;
  confirmed: number;
  unconfirmed: number;
  byCategory: Record<ChronologyCategory, number>;
  latestTimestamp: string | null;
}

/** Options for useChronology hook */
export interface UseChronologyOptions {
  /** Enable WebSocket real-time updates (default: true) */
  enableWebSocket?: boolean;
  /** Polling interval in ms as fallback (default: 5000, set to 0 to disable) */
  pollingInterval?: number;
  /** Backup sync interval in ms (default: 60000 = 1 minute, set to 0 to disable) */
  backupSyncInterval?: number;
  /** Initial filter state */
  initialFilters?: Partial<ChronologyFilters>;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_FILTERS: ChronologyFilters = {
  category: '',
  hqId: '',
  unconfirmedOnly: false,
};

// =============================================================================
// useChronology Hook
// =============================================================================

/**
 * Hook for managing chronology entries with filtering and real-time updates
 */
export function useChronology(
  sessionId: string,
  options: UseChronologyOptions = {}
): UseChronologyReturn {
  const {
    enableWebSocket = true,
    pollingInterval = 5000,
    backupSyncInterval = 60000, // 1 minute backup sync
    initialFilters = {},
  } = options;

  const queryClient = useQueryClient();
  const [filters, setFiltersState] = useState<ChronologyFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });
  const [wsState, setWsState] = useState<WebSocketState>('disconnected');

  // Convert filters to API params
  const apiParams = useMemo<ChronologyListParams | undefined>(() => {
    const params: ChronologyListParams = {};
    if (filters.category) params.category = filters.category;
    if (filters.hqId) params.hq_id = filters.hqId;
    if (filters.unconfirmedOnly) params.unconfirmed_only = true;
    return Object.keys(params).length > 0 ? params : undefined;
  }, [filters]);

  // Fetch chronology entries
  // staleTime: データが古いとみなされるまでの時間（再取得を抑制）
  // placeholderData: 再取得中も前のデータを表示し続ける
  const entriesQuery = useQuery({
    queryKey: chronologyQueryKeys.list(sessionId, apiParams),
    queryFn: async () => {
      const response = await chronologyApi.list(sessionId, apiParams);
      return response.data;
    },
    enabled: !!sessionId,
    refetchInterval: enableWebSocket ? undefined : pollingInterval,
    staleTime: 30000, // 30秒間はキャッシュを新鮮とみなす
    gcTime: 5 * 60 * 1000, // 5分間キャッシュを保持
  });

  // Fetch session info
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const response = await sessionsApi.get(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    staleTime: 60000, // 1分間はキャッシュを新鮮とみなす
    gcTime: 5 * 60 * 1000,
  });

  // Fetch participants (Zoom participants list for this session)
  const participantsQuery = useQuery({
    queryKey: ['participants', sessionId],
    queryFn: async () => {
      const response = await participantsApi.list(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });

  // Fetch HQ master
  const hqMasterQuery = useQuery({
    queryKey: ['hqMaster', sessionId],
    queryFn: async () => {
      const response = await sessionHqApi.list(sessionId);
      return response.data;
    },
    enabled: !!sessionId,
    staleTime: 60000,
    gcTime: 5 * 60 * 1000,
  });

  // Update entry mutation
  const updateMutation = useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: UpdateChronologyPayload }) =>
      chronologyApi.update(sessionId, entryId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chronologyQueryKeys.lists() });
    },
  });

  // WebSocket connection
  useEffect(() => {
    if (!enableWebSocket || !sessionId) return;

    const ws = createSessionWebSocket(sessionId);
    ws.connect();

    // Track state changes
    const unsubscribeState = ws.onStateChange((state) => {
      setWsState(state);
    });

    // Subscribe to new entries
    const unsubscribeEntry = ws.on('new_entry', () => {
      queryClient.invalidateQueries({
        queryKey: chronologyQueryKeys.lists(),
      });
    });

    return () => {
      unsubscribeState();
      unsubscribeEntry();
      ws.disconnect();
    };
  }, [sessionId, queryClient, enableWebSocket]);

  // Backup sync interval - ensures data is periodically refreshed from server
  useEffect(() => {
    if (!backupSyncInterval || !sessionId) return;

    const intervalId = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: chronologyQueryKeys.lists(),
      });
      console.log('[Chronology] Backup sync triggered');
    }, backupSyncInterval);

    return () => clearInterval(intervalId);
  }, [sessionId, queryClient, backupSyncInterval]);

  // Filter setters
  const setFilters = useCallback((newFilters: Partial<ChronologyFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  // Update entry action
  const updateEntry = useCallback(
    (entryId: string, data: UpdateChronologyPayload) => {
      updateMutation.mutate({ entryId, data });
    },
    [updateMutation]
  );

  // Refetch action
  const refetch = useCallback(() => {
    entriesQuery.refetch();
    sessionQuery.refetch();
    participantsQuery.refetch();
  }, [entriesQuery, sessionQuery, participantsQuery]);

  // Compute stats
  const stats = useMemo<ChronologyStats>(() => {
    const entries = entriesQuery.data;
    if (!entries || entries.length === 0) {
      return {
        total: 0,
        confirmed: 0,
        unconfirmed: 0,
        byCategory: {
          '指示': 0,
          '依頼': 0,
          '報告': 0,
          '決定': 0,
          '確認': 0,
          'リスク': 0,
          'その他': 0,
        },
        latestTimestamp: null,
      };
    }

    const byCategory = entries.reduce(
      (acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + 1;
        return acc;
      },
      {} as Record<ChronologyCategory, number>
    );

    // Ensure all categories are present
    const fullByCategory: Record<ChronologyCategory, number> = {
      '指示': byCategory['指示'] || 0,
      '依頼': byCategory['依頼'] || 0,
      '報告': byCategory['報告'] || 0,
      '決定': byCategory['決定'] || 0,
      '確認': byCategory['確認'] || 0,
      'リスク': byCategory['リスク'] || 0,
      'その他': byCategory['その他'] || 0,
    };

    return {
      total: entries.length,
      confirmed: entries.filter((e) => e.is_hq_confirmed).length,
      unconfirmed: entries.filter((e) => !e.is_hq_confirmed).length,
      byCategory: fullByCategory,
      latestTimestamp: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
    };
  }, [entriesQuery.data]);

  return {
    // Data
    entries: entriesQuery.data,
    session: sessionQuery.data,
    hqMaster: hqMasterQuery.data,
    participants: participantsQuery.data,
    // Loading states
    isLoading: entriesQuery.isLoading || sessionQuery.isLoading,
    isEntriesLoading: entriesQuery.isLoading,
    isSessionLoading: sessionQuery.isLoading,
    // Error states
    isError: entriesQuery.isError || sessionQuery.isError,
    error: (entriesQuery.error || sessionQuery.error) as ApiError | null,
    // Filters
    filters,
    setFilters,
    resetFilters,
    // Actions
    updateEntry,
    refetch,
    // Mutation states
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error as ApiError | null,
    // WebSocket
    wsState,
    // Stats
    stats,
  };
}

// =============================================================================
// useChronologyAutoScroll Hook
// =============================================================================

/** Options for auto-scroll behavior */
export interface UseChronologyAutoScrollOptions {
  /** Whether auto-scroll is enabled (default: true) */
  enabled?: boolean;
  /** Scroll behavior (default: 'smooth') */
  behavior?: ScrollBehavior;
}

/**
 * Hook for managing auto-scroll behavior in chronology views
 */
export function useChronologyAutoScroll(
  entries: ChronologyEntry[] | undefined,
  options: UseChronologyAutoScrollOptions = {}
): {
  scrollRef: React.RefObject<HTMLDivElement>;
  autoScroll: boolean;
  setAutoScroll: (enabled: boolean) => void;
} {
  const { enabled = true, behavior = 'smooth' } = options;
  const [autoScroll, setAutoScroll] = useState(enabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevEntriesLengthRef = useRef<number>(0);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current || !entries) return;

    // Only scroll when new entries are added
    if (entries.length > prevEntriesLengthRef.current) {
      scrollRef.current.scrollIntoView({ behavior });
    }
    prevEntriesLengthRef.current = entries.length;
  }, [entries, autoScroll, behavior]);

  return {
    scrollRef: scrollRef as React.RefObject<HTMLDivElement>,
    autoScroll,
    setAutoScroll,
  };
}

// =============================================================================
// useCategoryBadge Hook
// =============================================================================

/**
 * Get the appropriate style classes for a category badge
 */
export function useCategoryStyle(category: ChronologyCategory): string {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES['その他'];
}

// =============================================================================
// useChronologyFilters Hook
// =============================================================================

/**
 * Standalone hook for managing chronology filters
 * Useful when filter state needs to be shared across components
 */
export function useChronologyFilters(initialFilters?: Partial<ChronologyFilters>) {
  const [filters, setFiltersState] = useState<ChronologyFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });

  const setFilters = useCallback((newFilters: Partial<ChronologyFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const setCategory = useCallback((category: ChronologyCategory | '') => {
    setFiltersState((prev) => ({ ...prev, category }));
  }, []);

  const setHqId = useCallback((hqId: string) => {
    setFiltersState((prev) => ({ ...prev, hqId }));
  }, []);

  const setUnconfirmedOnly = useCallback((unconfirmedOnly: boolean) => {
    setFiltersState((prev) => ({ ...prev, unconfirmedOnly }));
  }, []);

  const hasActiveFilters = useMemo(() => {
    return filters.category !== '' || filters.hqId !== '' || filters.unconfirmedOnly;
  }, [filters]);

  return {
    filters,
    setFilters,
    resetFilters,
    setCategory,
    setHqId,
    setUnconfirmedOnly,
    hasActiveFilters,
  };
}
