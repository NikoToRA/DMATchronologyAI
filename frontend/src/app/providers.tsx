'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { UserSessionProvider } from '@/contexts/UserSessionContext';
import { AdminSessionProvider } from '@/contexts/AdminSessionContext';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AdminSessionProvider>
        <UserSessionProvider>{children}</UserSessionProvider>
      </AdminSessionProvider>
    </QueryClientProvider>
  );
}
