import React from 'react';
import { BookOpen, Brain, Sparkles, FileText, BarChart3, Shield, Settings, LogOut, Moon, Sun, Monitor } from 'lucide-react';
import { User, UserSettings } from '../types';

interface HeaderProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  user: User | null;
  settings: UserSettings | null;
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenAuth: () => void;
  theme: 'system' | 'light' | 'dark';
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  user,
  onOpenSettings,
  onLogout,
  onOpenAuth,
  theme,
  onToggleTheme,
}) => {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div 
          onClick={() => onSelectTab('decks')}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-sm shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-lg text-slate-900 dark:text-white tracking-tight">
              Smart<span className="text-blue-600 dark:text-blue-400">Vocab</span>
            </span>
            <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">
              .io
            </span>
          </div>
        </div>

        {/* Primary Tabs (When Logged In) */}
        {user && (
          <nav className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl">
            <button
              onClick={() => onSelectTab('decks')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentTab === 'decks'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Bộ thẻ</span>
            </button>

            <button
              onClick={() => onSelectTab('study')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentTab === 'study'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Brain className="w-4 h-4" />
              <span>Ôn tập SRS</span>
            </button>

            <button
              onClick={() => onSelectTab('dictionary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentTab === 'dictionary'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Tra từ AI</span>
            </button>

            <button
              onClick={() => onSelectTab('reading')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentTab === 'reading'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Bài đọc AI</span>
            </button>

            <button
              onClick={() => onSelectTab('stats')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentTab === 'stats'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Thống kê</span>
            </button>

            {user.role === 'admin' && (
              <button
                onClick={() => onSelectTab('admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  currentTab === 'admin'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Quản trị</span>
              </button>
            )}
          </nav>
        )}

        {/* Right Action Controls */}
        <div className="flex items-center gap-2">
          {/* Theme Toggle */}
          <button
            onClick={onToggleTheme}
            title="Đổi giao diện Sáng / Tối"
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenSettings}
                title="Cài đặt tài khoản"
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>

              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                  {user.displayName}
                </span>
                <span className="text-[11px] text-slate-400">
                  {user.role === 'admin' ? 'Admin' : 'Học viên'}
                </span>
              </div>

              <button
                onClick={onLogout}
                title="Đăng xuất"
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors ml-1"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-all"
            >
              Đăng nhập / Xin cấp quyền
            </button>
          )}
        </div>
      </div>

      {/* Mobile Tab Bar */}
      {user && (
        <div className="md:hidden flex items-center justify-around border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 bg-slate-50 dark:bg-slate-900/95 overflow-x-auto">
          <button
            onClick={() => onSelectTab('decks')}
            className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
              currentTab === 'decks' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Bộ thẻ</span>
          </button>
          <button
            onClick={() => onSelectTab('study')}
            className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
              currentTab === 'study' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>Ôn tập</span>
          </button>
          <button
            onClick={() => onSelectTab('dictionary')}
            className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
              currentTab === 'dictionary' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Tra từ</span>
          </button>
          <button
            onClick={() => onSelectTab('reading')}
            className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
              currentTab === 'reading' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Bài đọc</span>
          </button>
          <button
            onClick={() => onSelectTab('stats')}
            className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
              currentTab === 'stats' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Thống kê</span>
          </button>
          {user.role === 'admin' && (
            <button
              onClick={() => onSelectTab('admin')}
              className={`flex flex-col items-center gap-1 py-1 px-3 text-xs font-medium ${
                currentTab === 'admin' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Admin</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
};
