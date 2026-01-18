'use client';

import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Clock,
  Settings,
  AlertCircle,
  FolderOpen,
  FolderDot,
  Plus,
  ChevronRight,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { incidentsApi, type Incident } from '@/lib/api';
import { useAdminSession } from '@/contexts/AdminSessionContext';

// Navigation item type
interface NavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

// Navigation configuration
const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { name: 'セッション一覧', href: '/admin', icon: LayoutDashboard },
  { name: '設定', href: '/settings', icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <Logo />
      <Navigation pathname={pathname} />
      <IncidentNavigation selectedIncidentId={searchParams.get('incident')} />
      <Footer />
    </div>
  );
}

// Logo section
function Logo() {
  return (
    <div className="h-16 flex items-center px-6 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <Clock className="h-8 w-8 text-primary-600" />
        <div>
          <h1 className="font-bold text-lg text-gray-900">ChronologyAI</h1>
          <p className="text-xs text-gray-500">DMAT支援システム</p>
        </div>
      </div>
    </div>
  );
}

// Navigation section
interface NavigationProps {
  pathname: string;
}

function Navigation({ pathname }: NavigationProps) {
  return (
    <nav className="flex-1 px-4 py-4 space-y-1">
      {NAVIGATION_ITEMS.map((item) => (
        <NavItem key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function IncidentNavigation({ selectedIncidentId }: { selectedIncidentId: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => incidentsApi.list().then((r) => r.data),
  });

  const createIncidentMutation = useMutation({
    mutationFn: (data: { incident_name: string; incident_date: string }) =>
      incidentsApi.create(data).then((r) => r.data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      router.push(`/admin?incident=${created.incident_id}`);
    },
  });

  const activeIncidents = useMemo(
    () => (incidents ?? []).filter((i) => i.status === 'active'),
    [incidents]
  );
  const endedIncidents = useMemo(
    () => (incidents ?? []).filter((i) => i.status === 'ended'),
    [incidents]
  );

  const handleCreateIncident = useCallback(() => {
    const name = window.prompt('災害名を入力してください（例：能登半島地震）');
    if (!name || !name.trim()) return;
    const date = window.prompt(
      '発災日を入力してください（YYYY-MM-DD）',
      new Date().toISOString().slice(0, 10)
    );
    if (!date || !date.trim()) return;
    createIncidentMutation.mutate({
      incident_name: name.trim(),
      incident_date: date.trim(),
    });
  }, [createIncidentMutation]);

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between px-2 py-2">
        <div className="text-xs font-semibold text-gray-500">災害ボックス</div>
        <button
          onClick={handleCreateIncident}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          disabled={createIncidentMutation.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          {createIncidentMutation.isPending ? '作成中...' : '＋災害'}
        </button>
      </div>

      {isLoading ? (
        <div className="px-2 py-2 text-xs text-gray-500">読み込み中...</div>
      ) : !incidents || incidents.length === 0 ? (
        <div className="px-2 py-2 text-xs text-gray-500">まだ災害ボックスがありません</div>
      ) : (
        <div className="space-y-3">
          <IncidentGroup
            title="対応中"
            icon={<FolderOpen className="h-4 w-4" />}
            incidents={activeIncidents}
            selectedIncidentId={selectedIncidentId}
          />
          <IncidentGroup
            title="終了"
            icon={<FolderDot className="h-4 w-4" />}
            incidents={endedIncidents}
            selectedIncidentId={selectedIncidentId}
          />
        </div>
      )}
    </div>
  );
}

function IncidentGroup({
  title,
  icon,
  incidents,
  selectedIncidentId,
}: {
  title: string;
  icon: React.ReactNode;
  incidents: Incident[];
  selectedIncidentId: string | null;
}) {
  if (incidents.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-500">
        {icon}
        {title}
      </div>
      <div className="space-y-1">
        {incidents.map((inc) => {
          const isSelected = inc.incident_id === selectedIncidentId;
          return (
            <Link
              key={inc.incident_id}
              href={`/admin?incident=${inc.incident_id}`}
              className={`group flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                isSelected ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{inc.incident_name}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  発災日: {inc.incident_date.replaceAll('-', '/')}
                </div>
              </div>
              <ChevronRight
                className={`h-4 w-4 flex-shrink-0 ${
                  isSelected ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-500'
                }`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Navigation item
interface NavItemProps {
  item: NavigationItem;
  pathname: string;
}

function NavItem({ item, pathname }: NavItemProps) {
  const isActive = useMemo(() => {
    if (item.href === '/admin') {
      return pathname === '/admin';
    }
    return pathname.startsWith(item.href);
  }, [item.href, pathname]);

  const linkClasses = useMemo(() => {
    const baseClasses = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
    const activeClasses = isActive
      ? 'bg-primary-50 text-primary-700'
      : 'text-gray-700 hover:bg-gray-100';
    return `${baseClasses} ${activeClasses}`;
  }, [isActive]);

  const Icon = item.icon;

  return (
    <Link href={item.href} className={linkClasses}>
      <Icon className="h-5 w-5" />
      {item.name}
    </Link>
  );
}

// Footer section
function Footer() {
  const router = useRouter();
  const { adminLogout } = useAdminSession();

  const handleLogout = useCallback(() => {
    adminLogout();
    router.push('/');
  }, [adminLogout, router]);

  return (
    <div className="p-4 border-t border-gray-200 space-y-3">
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <AlertCircle className="h-4 w-4" />
        <span>Phase 1 MVP</span>
      </div>
    </div>
  );
}
