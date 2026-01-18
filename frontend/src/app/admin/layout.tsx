'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { useAdminSession } from '@/contexts/AdminSessionContext';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdminLoggedIn } = useAdminSession();

  const isLoginPage = pathname === '/admin/login';

  // Redirect to login if not authenticated (except on login page)
  useEffect(() => {
    if (!isAdminLoggedIn && !isLoginPage) {
      router.push('/admin/login');
    }
  }, [isAdminLoggedIn, isLoginPage, router]);

  // Show login page without sidebar
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Show loading while checking auth
  if (!isAdminLoggedIn) {
    return null;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
