'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

// =============================================================================
// Types
// =============================================================================

export interface UserSession {
  incidentId: string;
  incidentName: string;
  speakerName: string;  // 本部名
  speakerId: string;    // participant_id (サーバーで発行)
  joinedAt: string;     // ISO8601
}

interface UserSessionContextValue {
  session: UserSession | null;
  isLoggedIn: boolean;
  login: (data: Omit<UserSession, 'joinedAt'>) => void;
  logout: () => void;
  updateSpeakerId: (speakerId: string) => void;
}

// =============================================================================
// Context
// =============================================================================

const UserSessionContext = createContext<UserSessionContextValue | undefined>(undefined);

const STORAGE_KEY = 'chronology_user_session';

// =============================================================================
// Provider
// =============================================================================

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserSession;
        setSession(parsed);
      }
    } catch (e) {
      console.error('Failed to load user session from localStorage:', e);
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage when session changes
  useEffect(() => {
    if (!isInitialized) return;

    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session, isInitialized]);

  const login = useCallback((data: Omit<UserSession, 'joinedAt'>) => {
    const newSession: UserSession = {
      ...data,
      joinedAt: new Date().toISOString(),
    };
    setSession(newSession);
  }, []);

  const logout = useCallback(() => {
    setSession(null);
  }, []);

  const updateSpeakerId = useCallback((speakerId: string) => {
    setSession((prev) => {
      if (!prev) return null;
      return { ...prev, speakerId };
    });
  }, []);

  // Don't render children until initialized to prevent hydration mismatch
  if (!isInitialized) {
    return null;
  }

  return (
    <UserSessionContext.Provider
      value={{
        session,
        isLoggedIn: !!session,
        login,
        logout,
        updateSpeakerId,
      }}
    >
      {children}
    </UserSessionContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useUserSession() {
  const context = useContext(UserSessionContext);
  if (context === undefined) {
    throw new Error('useUserSession must be used within a UserSessionProvider');
  }
  return context;
}
