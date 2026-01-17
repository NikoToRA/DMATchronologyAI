'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Radio,
  Truck,
  BarChart3,
  Package,
  Plus,
  LogOut,
  ArrowRight,
} from 'lucide-react';
import { incidentsApi, Incident } from '@/lib/api';
import { useUserSession } from '@/contexts/UserSessionContext';

// Session type icons and labels
const SESSION_CONFIG = {
  activity_command: {
    label: '活動指揮',
    icon: Radio,
    color: 'bg-red-100 text-red-700 border-red-200',
    hoverColor: 'hover:bg-red-50 hover:border-red-300',
  },
  transport_coordination: {
    label: '搬送調整',
    icon: Truck,
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    hoverColor: 'hover:bg-blue-50 hover:border-blue-300',
  },
  info_analysis: {
    label: '情報分析',
    icon: BarChart3,
    color: 'bg-green-100 text-green-700 border-green-200',
    hoverColor: 'hover:bg-green-50 hover:border-green-300',
  },
  logistics_support: {
    label: '物資支援',
    icon: Package,
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    hoverColor: 'hover:bg-yellow-50 hover:border-yellow-300',
  },
} as const;

type SessionKind = keyof typeof SESSION_CONFIG;

export default function UserIncidentPage() {
  const params = useParams();
  const router = useRouter();
  const incidentId = params.id as string;
  const { session, isLoggedIn, logout } = useUserSession();

  // Redirect if not logged in or different incident
  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/user');
      return;
    }
    if (session && session.incidentId !== incidentId) {
      // User is logged into a different incident
      router.push(`/user/incident/${session.incidentId}`);
    }
  }, [isLoggedIn, session, incidentId, router]);

  // Fetch incident data
  const { data: incident, isLoading } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => incidentsApi.get(incidentId).then((res) => res.data),
    enabled: !!incidentId,
  });

  const handleSessionClick = (sessionId: string) => {
    router.push(`/user/session/${sessionId}`);
  };

  const handleLogout = () => {
    logout();
    router.push('/user');
  };

  if (!isLoggedIn || !session) {
    return null; // Will redirect
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">災害ボックスが見つかりません</div>
      </div>
    );
  }

  // Get available sessions
  const mainSessions = (
    ['activity_command', 'transport_coordination', 'info_analysis', 'logistics_support'] as SessionKind[]
  )
    .filter((kind) => incident.sessions[kind])
    .map((kind) => ({
      kind,
      sessionId: incident.sessions[kind],
      ...SESSION_CONFIG[kind],
    }));

  const extraSessions = incident.extra_sessions ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {incident.incident_name}
              </h1>
              <p className="text-sm text-gray-500">
                {incident.incident_date}〜
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg">
                <Building2 className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-700">
                  {session.speakerName}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"
              >
                <LogOut className="h-4 w-4" />
                退出
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            参加するセッションを選択
          </h2>
          <p className="text-sm text-gray-500">
            Zoomで会議に参加後、対応するセッションを選んでクロノロジーに参加してください
          </p>
        </div>

        {/* Main Sessions Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {mainSessions.map(({ kind, sessionId, label, icon: Icon, color, hoverColor }) => (
            <button
              key={kind}
              onClick={() => handleSessionClick(sessionId)}
              className={`p-6 rounded-xl border-2 ${color} ${hoverColor} transition-all text-left group`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/50 rounded-lg">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="text-lg font-semibold">{label}</span>
                </div>
                <ArrowRight className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>

        {/* Extra Sessions */}
        {extraSessions.length > 0 && (
          <>
            <div className="mb-4">
              <h3 className="text-md font-semibold text-gray-700">
                追加セッション
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {extraSessions.map((extra) => (
                <button
                  key={extra.session_id}
                  onClick={() => handleSessionClick(extra.session_id)}
                  className="p-4 rounded-xl border-2 border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <Plus className="h-5 w-5 text-gray-600" />
                      </div>
                      <span className="font-medium text-gray-700">
                        {extra.label}
                      </span>
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Instructions */}
        <div className="mt-8 p-4 bg-blue-50 rounded-xl text-sm text-blue-800">
          <h4 className="font-semibold mb-2">使い方</h4>
          <ol className="list-decimal list-inside space-y-1">
            <li>Zoomで該当の会議に参加してください（別ウィンドウ）</li>
            <li>上のセッションボタンから対応するセッションに入室</li>
            <li>Spaceキーを押しながら発話すると、クロノロジーに記録されます</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
