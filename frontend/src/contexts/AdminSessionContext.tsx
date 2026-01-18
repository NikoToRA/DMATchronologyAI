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

interface AdminSessionContextValue {
  isAdminLoggedIn: boolean;
  adminLogin: (password: string) => boolean;
  adminLogout: () => void;
}

// =============================================================================
// Context
// =============================================================================

const AdminSessionContext = createContext<AdminSessionContextValue | undefined>(undefined);

// NOTE:
// 管理者ログインは「毎回ログインから開始」したい要件のため永続化しない。
// （localStorageに保存しない / リロードでログアウト扱い）
// const STORAGE_KEY = 'chronology_admin_session';
// シンプルなパスワード認証（本番では環境変数やバックエンド認証に置き換え）
const ADMIN_PASSWORD = 'dmat2024';

// =============================================================================
// Provider
// =============================================================================

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

  const adminLogin = useCallback((password: string): boolean => {
    if (password === ADMIN_PASSWORD) {
      setIsAdminLoggedIn(true);
      return true;
    }
    return false;
  }, []);

  const adminLogout = useCallback(() => {
    setIsAdminLoggedIn(false);
  }, []);

  return (
    <AdminSessionContext.Provider
      value={{
        isAdminLoggedIn,
        adminLogin,
        adminLogout,
      }}
    >
      {children}
    </AdminSessionContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (context === undefined) {
    throw new Error('useAdminSession must be used within an AdminSessionProvider');
  }
  return context;
}
