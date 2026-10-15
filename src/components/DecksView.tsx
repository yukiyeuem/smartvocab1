import React, { useState } from 'react';
import { Plus, Upload, Download, Search, BookOpen, Brain, MoreVertical, Trash2, Edit3, ArrowRight, Sparkles, AlertTriangle, X } from 'lucide-react';
import { Deck } from '../types';

interface DecksViewProps {
  decks: Deck[];
  onOpenCreateDeck: () => void;
  onOpenEditDeck: (deck: Deck) => void;
  onDeleteDeck: (deckId: string) => Promise<void> | void;
  onClearDeckCards?: (deckId: string) => Promise<void> | void;
  onStartStudy: (deckId?: string) => void;
  onOpenImport: () => void;
  onOpenDictionary: () => void;
}

export const DecksView: React.FC<DecksViewProps> = ({
  decks,
  onOpenCreateDeck,
  onOpenEditDeck,
  onDeleteDeck,
  onClearDeckCards,
  onStartStudy,
  onOpenImport,
  onOpenDictionary,
}) => {
  const [search, setSearch] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ type: 'deck' | 'all_cards'; deck: Deck } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredDecks = (decks || []).filter(d => {
    if (!d) return false;
    const s = (search || '').toLowerCase();
    const titleMatch = (d.title || '').toLowerCase().includes(s);
    const topicMatch = (d.topic || '').toLowerCase().includes(s);
    const descMatch = (d.description || '').toLowerCase().includes(s);
    return titleMatch || topicMatch || descMatch;
  });

  const totalCardsAllDecks = decks.reduce((acc, d) => acc + (d.totalCards || 0), 0);
  const totalDueAllDecks = decks.reduce((acc, d) => acc + (d.dueCards || 0), 0);

  const handleExportDeck = async (deckId: string, format: 'csv' | 'json') => {
    window.open(`/api/decks/${deckId}/export?format=${format}`, '_blank');
    setActiveMenuId(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Summary */}
      <div className="bg-gradient-to-r from-blue-600 to-sky-600 rounded-2xl p-6 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Thư viện Bộ thẻ Từ vựng</h1>
          <p className="text-blue-100 text-sm mt-1">
            Ghi nhớ từ vựng tiếng Anh bền bỉ qua thuật toán Spaced Repetition khoa học
          </p>
          <div className="flex items-center gap-4 mt-3 text-xs text-blue-100 font-medium">
            <span>Tổng cộng: {decks.length} bộ thẻ</span>
            <span>·</span>
            <span>{totalCardsAllDecks} từ vựng</span>
            <span>·</span>
            <span className="bg-white/20 px-2 py-0.5 rounded-md text-white font-semibold">
              {totalDueAllDecks} thẻ đến hạn hôm nay
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {totalDueAllDecks > 0 && (
            <button
              onClick={() => onStartStudy()}
              className="px-4 py-2 bg-white text-blue-600 hover:bg-blue-50 font-semibold rounded-xl text-sm shadow-sm transition-all flex items-center gap-2"
            >
              <Brain className="w-4 h-4" />
              <span>Ôn tập ngay ({totalDueAllDecks})</span>
            </button>
          )}

          <button
            onClick={onOpenCreateDeck}
            className="px-4 py-2 bg-blue-700/60 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm border border-white/20 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo bộ mới</span>
          </button>
        </div>
      </div>

      {/* Action Bar & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm bộ thẻ theo tên, chủ đề..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenImport}
            className="px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Nhập CSV / Dán bảng</span>
          </button>

          <a
            href="/api/import/template"
            download
            className="px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Tải file mẫu</span>
          </a>
        </div>
      </div>

      {/* Decks Grid or Empty State */}
      {filteredDecks.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800">
          <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {search ? 'Không tìm thấy bộ thẻ phù hợp' : 'Chưa có bộ thẻ nào'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-6">
            {search
              ? 'Thử tìm với từ khóa khác hoặc xóa bộ lọc tìm kiếm.'
              : 'Hãy bắt đầu hành trình ghi nhớ từ vựng bằng cách tạo bộ thẻ mới, nhập từ file CSV/Excel hoặc tra từ điển AI.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onOpenCreateDeck}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo bộ thẻ đầu tiên</span>
            </button>
            <button
              onClick={onOpenImport}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Upload className="w-4 h-4" />
              <span>Nhập file từ vựng</span>
            </button>
            <button
              onClick={onOpenDictionary}
              className="px-4 py-2 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 text-sky-700 dark:text-sky-300 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" />
              <span>Tra từ AI</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDecks.map(deck => {
            const hasDue = (deck.dueCards || 0) > 0;
            const hasCards = (deck.totalCards || 0) > 0;

            return (
              <div
                key={deck.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 hover:border-blue-400 dark:hover:border-blue-600/60 transition-all flex flex-col justify-between group shadow-xs hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      {deck.topic && (
                        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider block mb-1">
                          {deck.topic}
                        </span>
                      )}
                      <h3 className="font-bold text-slate-900 dark:text-white text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                        {deck.title}
                      </h3>
                    </div>

                    {/* Options Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === deck.id ? null : deck.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeMenuId === deck.id && (
                        <div className="absolute right-0 top-8 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 py-1 text-xs">
                          <button
                            onClick={() => {
                              onOpenEditDeck(deck);
                              setActiveMenuId(null);
                            }}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Chỉnh sửa bộ thẻ</span>
                          </button>

                          <button
                            onClick={() => handleExportDeck(deck.id, 'csv')}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Xuất ra CSV</span>
                          </button>

                          <button
                            onClick={() => handleExportDeck(deck.id, 'json')}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Xuất ra JSON</span>
                          </button>

                          <div className="border-t border-slate-100 dark:border-slate-700 my-1" />

                          <button
                            onClick={() => {
                              setActiveMenuId(null);
                              setConfirmTarget({ type: 'all_cards', deck });
                            }}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa toàn bộ thẻ ({deck.totalCards || 0})</span>
                          </button>

                          <button
                            onClick={() => {
                              setActiveMenuId(null);
                              setConfirmTarget({ type: 'deck', deck });
                            }}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa bộ thẻ này</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {deck.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1.5">
                      {deck.description}
                    </p>
                  )}
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {/* Status counts */}
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="text-slate-500 font-medium">
                      {deck.totalCards || 0} từ
                    </span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Mới: {deck.newCards || 0}</span>
                      <span className="text-blue-500 font-semibold">Đến hạn: {deck.dueCards || 0}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onStartStudy(deck.id)}
                      disabled={!hasCards}
                      className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                        hasDue
                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span>{hasDue ? `Ôn tập (${deck.dueCards})` : 'Học bộ này'}</span>
                    </button>

                    <button
                      onClick={() => onOpenEditDeck(deck)}
                      title="Sửa / Thêm từ"
                      className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete / Clear Confirmation Modal (No window.confirm!) */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                confirmTarget.type === 'deck'
                  ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                  : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
              }`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {confirmTarget.type === 'deck' ? 'Xác nhận xóa bộ thẻ?' : 'Xác nhận xóa toàn bộ thẻ?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {confirmTarget.type === 'deck' ? (
                    <>
                      Bạn có chắc chắn muốn xóa bộ thẻ <strong className="text-slate-900 dark:text-white font-semibold">"{confirmTarget.deck.title}"</strong> và toàn bộ <strong className="text-red-600 dark:text-red-400 font-semibold">{confirmTarget.deck.totalCards || 0} từ vựng</strong> kèm tiến độ học không? Hành động này không thể hoàn tác.
                    </>
                  ) : (
                    <>
                      Bạn có chắc muốn xóa <strong className="text-amber-600 dark:text-amber-400 font-semibold">toàn bộ {confirmTarget.deck.totalCards || 0} từ vựng</strong> trong bộ thẻ <strong className="text-slate-900 dark:text-white font-semibold">"{confirmTarget.deck.title}"</strong> không? Bộ thẻ sẽ được giữ lại với 0 từ vựng để bạn thêm lại từ mới.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    if (confirmTarget.type === 'deck') {
                      await onDeleteDeck(confirmTarget.deck.id);
                    } else if (onClearDeckCards) {
                      await onClearDeckCards(confirmTarget.deck.id);
                    }
                    setConfirmTarget(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                  confirmTarget.type === 'deck'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                <Trash2 className="w-4 h-4" />
                <span>
                  {isDeleting
                    ? 'Đang xóa...'
                    : confirmTarget.type === 'deck'
                    ? 'Xóa bộ thẻ'
                    : 'Xóa toàn bộ từ'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
