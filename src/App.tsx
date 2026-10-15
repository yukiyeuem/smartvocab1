import React, { useState, useEffect } from 'react';
import { BookOpen, Brain, Sparkles, FileText, BarChart3, Shield, ArrowRight, Upload, CheckCircle2 } from 'lucide-react';
import { User, UserSettings, Deck } from './types';
import { apiRequest, setStoredSessionToken } from './lib/api';
import { Header } from './components/Header';
import { AuthModal } from './components/AuthModal';
import { DecksView } from './components/DecksView';
import { DeckEditorModal } from './components/DeckEditorModal';
import { ImportModal } from './components/ImportModal';
import { StudyModal } from './components/StudyModal';
import { DictionaryPanel } from './components/DictionaryPanel';
import { ReadingView } from './components/ReadingView';
import { StatsView } from './components/StatsView';
import { AdminPanel } from './components/AdminPanel';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [currentTab, setCurrentTab] = useState<string>('decks');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('vocab_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {}
    return 'system';
  });

  const [guestTab, setGuestTab] = useState<'landing' | 'dictionary'>('landing');
  // Decks list state
  const [decks, setDecks] = useState<Deck[]>([]);

  // Modals state
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isDeckEditorOpen, setIsDeckEditorOpen] = useState(false);
  const [deckToEdit, setDeckToEdit] = useState<Deck | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isStudyOpen, setIsStudyOpen] = useState(false);
  const [activeStudyDeckId, setActiveStudyDeckId] = useState<string | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Sync theme
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && media.matches);

      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    if (theme === 'system') {
      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
    }

    try {
      localStorage.setItem('vocab_theme', theme);
    } catch {}
  }, [theme]);

  const checkAuth = async () => {
    setLoadingUser(true);
    try {
      const res = await apiRequest<{ authenticated: boolean; user: User | null; settings: UserSettings | null }>('/api/auth/me');
      if (res.authenticated && res.user) {
        setUser(res.user);
        setSettings(res.settings);
        if (res.settings?.theme) {
          setTheme(res.settings.theme);
        }
        loadDecks();
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoadingUser(false);
    }
  };

  const loadDecks = async () => {
    try {
      const res = await apiRequest<{ decks: any[] }>('/api/decks');
      const normalizedDecks: Deck[] = (res.decks || []).map(d => {
        const total = Number(d.totalCards ?? d.card_count ?? d.total_cards ?? 0);
        const due = Number(d.dueCards ?? d.due_count ?? d.due_cards ?? 0);
        const reviewed = Number(d.reviewedCards ?? d.reviewed_cards ?? 0);
        const newCount = d.newCards !== undefined
          ? Number(d.newCards)
          : (d.new_count !== undefined ? Number(d.new_count) : Math.max(0, total - reviewed));

        return {
          ...d,
          title: d.title || 'Bộ thẻ',
          description: d.description || '',
          topic: d.topic || '',
          totalCards: total,
          dueCards: due,
          newCards: newCount,
          reviewedCards: reviewed,
        };
      });
      setDecks(normalizedDecks);
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredSessionToken(null);
    setUser(null);
    setDecks([]);
    setCurrentTab('decks');
  };

  const handleToggleTheme = () => {
    const isCurrentlyDark = document.documentElement.classList.contains('dark');
    const nextTheme: 'light' | 'dark' = isCurrentlyDark ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('vocab_theme', nextTheme);
    } catch {}
    if (user) {
      apiRequest('/api/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({ theme: nextTheme }),
      }).catch(() => {});
    }
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      await apiRequest(`/api/decks/${deckId}`, { method: 'DELETE' });
      await loadDecks();
    } catch (err: any) {
      console.error('Lỗi khi xóa bộ thẻ:', err);
    }
  };

  const handleClearDeckCards = async (deckId: string) => {
    try {
      await apiRequest(`/api/decks/${deckId}/cards`, { method: 'DELETE' });
      await loadDecks();
    } catch (err: any) {
      console.error('Lỗi khi xóa toàn bộ thẻ:', err);
    }
  };

  const handleStartStudy = (deckId?: string) => {
    setActiveStudyDeckId(deckId);
    setIsStudyOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors flex flex-col font-sans">
      {/* Header */}
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (!user) {
            if (tab === 'dictionary') setGuestTab('dictionary');
            else setGuestTab('landing');
            return;
          }
          if (tab === 'study') {
            handleStartStudy();
          } else {
            setCurrentTab(tab);
          }
        }}
        user={user}
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={handleLogout}
        onOpenAuth={() => setIsAuthOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {loadingUser ? (
          <div className="py-24 text-center">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-xs text-slate-400">Đang khởi tạo phiên làm việc...</p>
          </div>
        ) : !user ? (
          guestTab === 'dictionary' ? (
            /* Guest AI Dictionary Trial */
            <div className="space-y-6">
              <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm text-sky-800 dark:text-sky-200">
                  <div className="w-9 h-9 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">Chế độ trải nghiệm Tra từ Gemini AI</h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Bạn có thể tra từ không giới hạn với AI. Để tạo bộ thẻ và lưu trữ cá nhân, hãy đăng nhập.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setGuestTab('landing')}
                    className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold transition-all"
                  >
                    Về trang chủ
                  </button>
                  <button
                    onClick={() => setIsAuthOpen(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all"
                  >
                    Đăng nhập / Đăng ký
                  </button>
                </div>
              </div>

              <DictionaryPanel
                decks={decks}
                onCardAddedToDeck={() => setIsAuthOpen(true)}
              />
            </div>
          ) : (
            /* Public Guest Landing Page (FR-AU-01) */
            <div className="py-12 md:py-20 max-w-3xl mx-auto text-center space-y-8">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 rounded-full text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Nền tảng Học Từ vựng SRS Anki & AI Gemini</span>
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
                  Ghi nhớ từ vựng tiếng Anh <br className="hidden sm:inline" />
                  <span className="text-blue-600 dark:text-blue-400">
                    khoa học và lâu bền hơn
                  </span>
                </h1>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-xl mx-auto leading-relaxed">
                  Ứng dụng thuật toán lặp lại ngắt quãng (Spaced Repetition), kết hợp tra từ điển thông minh và sinh bài đọc ngữ cảnh thực tế từ Google Gemini.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => setIsAuthOpen(true)}
                  className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 group"
                >
                  <span>Đăng nhập OTP / Xin cấp quyền</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>

                <button
                  onClick={() => setGuestTab('dictionary')}
                  className="px-5 py-3.5 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-2xl text-sm font-semibold transition-all flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-sky-500" />
                  <span>Dùng thử Tra từ AI ngay</span>
                </button>

                <a
                  href="/api/import/template"
                  download
                  className="px-5 py-3.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm font-semibold transition-all flex items-center gap-2"
                >
                  <Upload className="w-4 h-4 text-slate-400" />
                  <span>Xem mẫu file CSV</span>
                </a>
              </div>

              {/* Feature Highlights Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-10 text-left">
                <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                    <Brain className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    Thuật toán SRS Anki 4 nút
                  </h3>
                  <p className="text-xs text-slate-500">
                    Lập lịch ôn tập ngắt quãng tối ưu theo múi giờ địa phương, hỗ trợ đầy đủ phím tắt và hoàn tác (Undo).
                  </p>
                </div>

                <div 
                  onClick={() => setGuestTab('dictionary')}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-sky-400 dark:hover:border-sky-600 rounded-2xl shadow-xs cursor-pointer transition-all group"
                >
                  <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 group-hover:text-sky-600 dark:group-hover:text-sky-400 flex items-center gap-1.5">
                    <span>Tra từ & Bài đọc Gemini AI</span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tự động điền nghĩa, phân loại từ, phiên âm IPA và sinh đoạn văn ngữ cảnh lồng ghép đúng các từ vựng đang học. (Bấm để thử ngay)
                  </p>
                </div>

                <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                    <Shield className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    Bảo mật & Quyền riêng tư
                  </h3>
                  <p className="text-xs text-slate-500">
                    Dữ liệu thẻ cá nhân được cô lập tuyệt đối. Admin quản trị cấp quyền mà không xem lén nội dung học tập.
                  </p>
                </div>
              </div>
            </div>
          )
        ) : (
          /* Authenticated Dashboard Views */
          <div>
            {currentTab === 'decks' && (
              <DecksView
                decks={decks}
                onOpenCreateDeck={() => {
                  setDeckToEdit(null);
                  setIsDeckEditorOpen(true);
                }}
                onOpenEditDeck={(deck) => {
                  setDeckToEdit(deck);
                  setIsDeckEditorOpen(true);
                }}
                onDeleteDeck={handleDeleteDeck}
                onClearDeckCards={handleClearDeckCards}
                onStartStudy={handleStartStudy}
                onOpenImport={() => setIsImportOpen(true)}
                onOpenDictionary={() => setCurrentTab('dictionary')}
              />
            )}

            {currentTab === 'dictionary' && (
              <DictionaryPanel
                decks={decks}
                onCardAddedToDeck={() => loadDecks()}
              />
            )}

            {currentTab === 'reading' && (
              <ReadingView decks={decks} />
            )}

            {currentTab === 'stats' && (
              <StatsView />
            )}

            {currentTab === 'admin' && user.role === 'admin' && (
              <AdminPanel />
            )}
          </div>
        )}
      </main>

      {/* Global Modals */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLoginSuccess={(loggedUser, loggedSettings) => {
          setUser(loggedUser);
          setSettings(loggedSettings);
          if (loggedSettings?.theme) setTheme(loggedSettings.theme);
          loadDecks();
        }}
      />

      <DeckEditorModal
        isOpen={isDeckEditorOpen}
        onClose={() => setIsDeckEditorOpen(false)}
        deckToEdit={deckToEdit}
        onSaveSuccess={() => loadDecks()}
      />

      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        decks={decks}
        onImportSuccess={() => loadDecks()}
      />

      <StudyModal
        isOpen={isStudyOpen}
        onClose={() => setIsStudyOpen(false)}
        deckId={activeStudyDeckId}
        decks={decks}
        settings={settings}
        onStudyComplete={() => loadDecks()}
      />

      {user && settings && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          user={user}
          settings={settings}
          onSettingsUpdated={(newSettings) => {
            setSettings(newSettings);
            if (newSettings.theme) {
              setTheme(newSettings.theme);
              try {
                localStorage.setItem('vocab_theme', newSettings.theme);
              } catch {}
            }
          }}
          onLogout={handleLogout}
        />
      )}

      {/* Clean quiet footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-400">
        <p>SmartVocab.io · Hệ thống học từ vựng tiếng Anh Spaced Repetition khoa học & Trợ lý Gemini AI</p>
      </footer>
    </div>
  );
}
