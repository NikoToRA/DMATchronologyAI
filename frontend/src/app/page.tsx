'use client';

import { useRouter } from 'next/navigation';
import { Radio, Settings, Users, ArrowRight } from 'lucide-react';

export default function EntryPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
            <Radio className="h-10 w-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            ChronologyAI
          </h1>
          <p className="text-gray-500 mt-3 text-lg">
            災害対応クロノロジーシステム
          </p>
        </div>

        {/* Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* User Entry */}
          <button
            onClick={() => router.push('/user')}
            className="group p-8 rounded-2xl border-2 border-blue-200 bg-white hover:border-blue-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <ArrowRight className="h-6 w-6 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              参加者として入室
            </h2>
            <p className="text-gray-500 text-sm">
              災害対応会議に参加して、Push-to-Talkで発話をクロノロジーに記録します
            </p>
            <div className="mt-4 text-blue-600 text-sm font-medium">
              本部名を入力して入室 →
            </div>
          </button>

          {/* Admin Entry */}
          <button
            onClick={() => router.push('/admin')}
            className="group p-8 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gray-100 rounded-xl">
                <Settings className="h-8 w-8 text-gray-600" />
              </div>
              <ArrowRight className="h-6 w-6 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              管理者として入室
            </h2>
            <p className="text-gray-500 text-sm">
              災害ボックスの作成・設定、クロノロジーの確認・編集を行います
            </p>
            <div className="mt-4 text-gray-600 text-sm font-medium">
              管理画面へ →
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-gray-400">
          DMAT Chronology AI System
        </div>
      </div>
    </div>
  );
}
