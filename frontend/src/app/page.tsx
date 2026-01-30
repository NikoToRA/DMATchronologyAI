'use client';

import { useRouter } from 'next/navigation';
import { Radio, Settings, Users, ArrowRight, Package, Activity } from 'lucide-react';

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

        {/* 班別入口 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* 統括・調整班 */}
          <button
            onClick={() => router.push('/user/command')}
            className="group p-6 rounded-2xl border-2 border-blue-200 bg-white hover:border-blue-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Activity className="h-6 w-6 text-blue-600" />
              </div>
              <ArrowRight className="h-5 w-5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              統括・調整班
            </h2>
            <p className="text-gray-500 text-xs">
              本部選択 → 発話記録
            </p>
          </button>

          {/* 物資支援班 */}
          <button
            onClick={() => router.push('/user/busshi')}
            className="group p-6 rounded-2xl border-2 border-yellow-200 bg-white hover:border-yellow-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-yellow-100 rounded-xl">
                <Package className="h-6 w-6 text-yellow-600" />
              </div>
              <ArrowRight className="h-5 w-5 text-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              物資支援班
            </h2>
            <p className="text-gray-500 text-xs">
              本部選択 → 発話記録
            </p>
          </button>
        </div>

        {/* その他のオプション */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* User Entry */}
          <button
            onClick={() => router.push('/user')}
            className="group p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-gray-100 rounded-xl">
                <Users className="h-6 w-6 text-gray-600" />
              </div>
              <ArrowRight className="h-5 w-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              一般参加者
            </h2>
            <p className="text-gray-500 text-xs">
              災害ボックス選択 → 入室
            </p>
          </button>

          {/* Admin Entry */}
          <button
            onClick={() => router.push('/admin/login')}
            className="group p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-400 hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-gray-100 rounded-xl">
                <Settings className="h-6 w-6 text-gray-600" />
              </div>
              <ArrowRight className="h-5 w-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              管理者
            </h2>
            <p className="text-gray-500 text-xs">
              設定・クロノロジー管理
            </p>
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
