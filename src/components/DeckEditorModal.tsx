import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Sparkles, ChevronDown, ChevronUp, AlertCircle, Save, X, Volume2, ArrowUp, ArrowDown, Check, CheckCircle2 } from 'lucide-react';
import { Deck, Card, DictionaryLookupResult } from '../types';
import { apiRequest } from '../lib/api';
import { speakEnglish } from '../lib/speech';

interface DeckEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  deckToEdit: Deck | null;
  onSaveSuccess: () => void;
}

interface CardDraft {
  id?: string;
  term: string;
  meaning_vi: string;
  definition_en: string;
  phonetic: string;
  part_of_speech: string;
  synonyms: string;
  antonyms: string;
  example: string;
  group_name: string;
  isExpanded?: boolean;
}

export const DeckEditorModal: React.FC<DeckEditorModalProps> = ({
  isOpen,
  onClose,
  deckToEdit,
  onSaveSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [cards, setCards] = useState<CardDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoadingIdx, setAiLoadingIdx] = useState<number | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, DictionaryLookupResult | null>>({});
  const [appliedBadgeIdx, setAppliedBadgeIdx] = useState<number | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const debounceTimers = useRef<Record<number, any>>({});

  const DRAFT_KEY = deckToEdit ? `vocab_deck_draft_${deckToEdit.id}` : 'vocab_deck_draft_new';

  useEffect(() => {
    if (!isOpen) return;

    if (deckToEdit) {
      setTitle(deckToEdit.title);
      setDescription(deckToEdit.description || '');
      setTopic(deckToEdit.topic || '');
      // Fetch full cards
      loadDeckCards(deckToEdit.id);
    } else {
      // Check local draft
      const savedDraft = localStorage.getItem(DRAFT_KEY);
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);
          setTitle(parsed.title || '');
          setDescription(parsed.description || '');
          setTopic(parsed.topic || '');
          setCards(parsed.cards || []);
          return;
        } catch {
          // ignore corrupted draft
        }
      }

      // Initialize with 3 empty cards
      setTitle('');
      setDescription('');
      setTopic('');
      setCards([
        { term: '', meaning_vi: '', definition_en: '', phonetic: '', part_of_speech: '', synonyms: '', antonyms: '', example: '', group_name: '', isExpanded: false },
        { term: '', meaning_vi: '', definition_en: '', phonetic: '', part_of_speech: '', synonyms: '', antonyms: '', example: '', group_name: '', isExpanded: false },
        { term: '', meaning_vi: '', definition_en: '', phonetic: '', part_of_speech: '', synonyms: '', antonyms: '', example: '', group_name: '', isExpanded: false },
      ]);
    }
  }, [isOpen, deckToEdit]);

  const loadDeckCards = async (deckId: string) => {
    try {
      const data = await apiRequest<{ deck: Deck; cards: Card[] }>(`/api/decks/${deckId}`);
      if (data.cards) {
        setCards(
          data.cards.map(c => ({
            id: c.id,
            term: c.term,
            meaning_vi: c.meaning_vi,
            definition_en: c.definition_en || '',
            phonetic: c.phonetic || '',
            part_of_speech: c.part_of_speech || '',
            synonyms: (c.synonyms || []).join('; '),
            antonyms: (c.antonyms || []).join('; '),
            example: c.example || '',
            group_name: c.group_name || '',
            isExpanded: false,
          }))
        );
      }
    } catch (err: any) {
      setError(err.message || 'Không thể tải chi tiết thẻ.');
    }
  };

  // Auto-save local draft (FR-DK-08)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (title.trim() || cards.some(c => c.term.trim())) {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ title, description, topic, cards })
        );
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [title, description, topic, cards, isOpen]);

  if (!isOpen) return null;

  const handleAddCard = () => {
    setCards([
      ...cards,
      { term: '', meaning_vi: '', definition_en: '', phonetic: '', part_of_speech: '', synonyms: '', antonyms: '', example: '', group_name: '', isExpanded: true },
    ]);
  };

  const handleRemoveCard = (index: number) => {
    const updated = [...cards];
    updated.splice(index, 1);
    setCards(updated);
  };

  const handleMoveCard = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === cards.length - 1)) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...cards];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setCards(updated);
  };

  const updateCardField = (index: number, field: keyof CardDraft, value: any) => {
    const updated = [...cards];
    updated[index] = { ...updated[index], [field]: value };
    setCards(updated);

    if (field === 'term') {
      const cleanTerm = (value || '').trim();
      if (debounceTimers.current[index]) {
        clearTimeout(debounceTimers.current[index]);
      }
      if (cleanTerm.length >= 2) {
        debounceTimers.current[index] = setTimeout(() => {
          fetchAiSuggestions(index, cleanTerm);
        }, 650);
      } else {
        setAiSuggestions(prev => ({ ...prev, [index]: null }));
      }
    }
  };

  const fetchAiSuggestions = async (index: number, termToLookup: string) => {
    if (!termToLookup) return;
    setAiLoadingIdx(index);
    try {
      const res = await apiRequest<{ success: boolean; data?: DictionaryLookupResult; senses?: any[] }>('/api/dictionary/lookup', {
        method: 'POST',
        body: JSON.stringify({ term: termToLookup }),
      });
      const data = res.data || (res.senses ? (res as any) : null);
      if (data) {
        setAiSuggestions(prev => ({ ...prev, [index]: data }));
      }
    } catch {
      // quiet fallback
    } finally {
      setAiLoadingIdx(null);
    }
  };

  const applyAllAiSuggestions = (index: number, senseIndex = 0) => {
    const sug = aiSuggestions[index];
    if (!sug) return;
    const sense = sug.senses?.[senseIndex] || sug.senses?.[0];
    if (!sense) return;

    const updated = [...cards];
    const current = updated[index];

    current.meaning_vi = sense.meaning_vi || current.meaning_vi;
    current.phonetic = sense.phonetic || sug.phonetic || current.phonetic;
    current.part_of_speech = sense.pos || current.part_of_speech;
    current.definition_en = sense.definition_en || current.definition_en;

    if (sug.word_family && sug.word_family.length > 0) {
      current.group_name = sug.word_family.join(', ');
    } else if (sug.group_name || sug.lemma) {
      current.group_name = sug.group_name || sug.lemma;
    }

    if (sense.examples && sense.examples.length > 0) {
      current.example = sense.examples[0];
    }
    if (sense.synonyms && sense.synonyms.length > 0) {
      current.synonyms = sense.synonyms.map((s: any) => (typeof s === 'string' ? s : s.word)).join('; ');
    }
    if (sense.antonyms && sense.antonyms.length > 0) {
      current.antonyms = sense.antonyms.join('; ');
    }

    current.isExpanded = true;
    setCards(updated);
    setAppliedBadgeIdx(index);
    setTimeout(() => setAppliedBadgeIdx(null), 2500);
  };

  // AI Auto-Fill button for card
  const handleAiAutoFill = async (index: number) => {
    const card = cards[index];
    if (!card.term.trim()) {
      setError('Vui lòng nhập thuật ngữ tiếng Anh trước khi tra gợi ý.');
      return;
    }
    await fetchAiSuggestions(index, card.term.trim());
  };

  const handleClearAllCards = async () => {
    setIsClearing(true);
    try {
      if (deckToEdit) {
        // Xóa sạch toàn bộ thẻ trên server nếu đang chỉnh sửa bộ thẻ đã có
        await apiRequest(`/api/decks/${deckToEdit.id}/cards`, { method: 'DELETE' });
      }
      setCards([
        { term: '', meaning_vi: '', definition_en: '', phonetic: '', part_of_speech: '', synonyms: '', antonyms: '', example: '', group_name: '', isExpanded: false }
      ]);
      setAiSuggestions({});
      localStorage.removeItem(DRAFT_KEY);
      setShowClearAllConfirm(false);
    } catch (err: any) {
      setError(err.message || 'Không thể xóa toàn bộ thẻ.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Tiêu đề bộ thẻ là bắt buộc.');
      return;
    }

    const validCards = cards.filter(c => c.term.trim() && c.meaning_vi.trim());
    if (validCards.length === 0 && !deckToEdit) {
      setError('Bộ thẻ mới cần ít nhất một thẻ có Thuật ngữ và Nghĩa tiếng Việt.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (deckToEdit) {
        // Update deck title / description
        await apiRequest(`/api/decks/${deckToEdit.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, description, topic }),
        });

        // Batch replace cards
        await apiRequest(`/api/decks/${deckToEdit.id}/cards/batch`, {
          method: 'POST',
          body: JSON.stringify({
            cards: validCards.map(c => ({
              term: c.term,
              meaning_vi: c.meaning_vi,
              definition_en: c.definition_en,
              phonetic: c.phonetic,
              part_of_speech: c.part_of_speech,
              synonyms: c.synonyms,
              antonyms: c.antonyms,
              example: c.example,
              group_name: c.group_name,
            })),
            mode: 'replace',
          }),
        });
      } else {
        // Create new deck with cards
        await apiRequest('/api/decks', {
          method: 'POST',
          body: JSON.stringify({
            title,
            description,
            topic,
            cards: validCards.map(c => ({
              term: c.term,
              meaning_vi: c.meaning_vi,
              definition_en: c.definition_en,
              phonetic: c.phonetic,
              part_of_speech: c.part_of_speech,
              synonyms: c.synonyms,
              antonyms: c.antonyms,
              example: c.example,
              group_name: c.group_name,
            })),
          }),
        });
      }

      // Clear draft on success
      localStorage.removeItem(DRAFT_KEY);
      onSaveSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Không thể lưu bộ thẻ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-white dark:bg-slate-900 sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {deckToEdit ? 'Chỉnh sửa Bộ thẻ' : 'Tạo Bộ Thẻ Mới'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Nhập từ vựng, tự động tra cứu bằng Gemini AI và quản lý chi tiết
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? 'Đang lưu...' : (deckToEdit ? 'Lưu thay đổi' : 'Tạo bộ thẻ')}</span>
            </button>
          </div>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Deck Info Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tiêu đề bộ thẻ *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ví dụ: 50 Từ vựng B2 thường gặp trong IELTS"
                className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Chủ đề chung
              </label>
              <input
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="Technology, Business..."
                className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Mô tả ngắn
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ghi chú thêm về mục đích hoặc nguồn bài học..."
                className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Cards List Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Danh sách thẻ từ vựng</span>
                <span className="text-xs font-normal text-slate-500">
                  ({cards.length} thẻ)
                </span>
              </h3>

              <div className="flex items-center gap-2">
                {cards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowClearAllConfirm(true)}
                    className="px-3 py-1.5 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                    title="Xóa toàn bộ thẻ trong danh sách"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa toàn bộ thẻ</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleAddCard}
                  className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-600 dark:text-blue-400 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Thêm thẻ</span>
                </button>
              </div>
            </div>

            {showClearAllConfirm && (
              <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-150">
                <div className="flex items-center gap-2.5 text-xs text-red-800 dark:text-red-200">
                  <AlertCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
                  <span>
                    Xác nhận xóa <strong>toàn bộ {cards.length} thẻ</strong> từ vựng? Thao tác này sẽ dọn sạch danh sách thẻ đang có.
                  </span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={() => setShowClearAllConfirm(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={handleClearAllCards}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isClearing ? 'Đang xóa...' : 'Xác nhận xóa toàn bộ'}</span>
                  </button>
                </div>
              </div>
            )}

            {cards.map((card, idx) => {
              const isAiLoading = aiLoadingIdx === idx;
              // Duplicate check within same form
              const isDuplicate = cards.some(
                (c, cIdx) => cIdx !== idx && c.term.trim() && c.term.trim().toLowerCase() === card.term.trim().toLowerCase()
              );

              return (
                <div
                  key={idx}
                  className={`p-4 rounded-2xl border transition-all ${
                    isDuplicate
                      ? 'border-amber-300 bg-amber-50/30 dark:border-amber-900/60 dark:bg-amber-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Card Header & Controls */}
                  <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-400">#{idx + 1}</span>
                      {isDuplicate && (
                        <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Thuật ngữ này bị lặp lại trong danh sách</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {card.term && (
                        <button
                          type="button"
                          onClick={() => speakEnglish(card.term)}
                          title="Nghe phát âm"
                          className="p-1 text-slate-400 hover:text-blue-600 rounded-md"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleMoveCard(idx, 'up')}
                        disabled={idx === 0}
                        title="Di chuyển lên"
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded-md"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveCard(idx, 'down')}
                        disabled={idx === cards.length - 1}
                        title="Di chuyển xuống"
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded-md"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCardField(idx, 'isExpanded', !card.isExpanded)}
                        title={card.isExpanded ? 'Thu gọn chi tiết' : 'Mở rộng chi tiết'}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
                      >
                        {card.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveCard(idx)}
                        title="Xóa thẻ này"
                        className="p-1 text-slate-400 hover:text-red-600 rounded-md ml-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Primary Row: Term + Auto Fill + Meaning */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span>Thuật ngữ tiếng Anh *</span>
                          {card.term && (
                            <button
                              type="button"
                              onClick={() => speakEnglish(card.term)}
                              title="Nghe phát âm"
                              className="text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </label>
                        <button
                          type="button"
                          disabled={!card.term.trim() || isAiLoading}
                          onClick={() => handleAiAutoFill(idx)}
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 disabled:opacity-40"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{isAiLoading ? 'AI đang tra cứu...' : '✨ Gợi ý thông minh AI'}</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={card.term}
                        onChange={e => updateCardField(idx, 'term', e.target.value)}
                        placeholder="Ví dụ: accept, resilient, persistent..."
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Nghĩa tiếng Việt *
                        </label>
                        {appliedBadgeIdx === idx && (
                          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-pulse">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Đã áp dụng toàn bộ đề xuất!</span>
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        value={card.meaning_vi}
                        onChange={e => updateCardField(idx, 'meaning_vi', e.target.value)}
                        placeholder="Ví dụ: chấp nhận, bằng lòng"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* AI Suggestion Box (when available or loading) */}
                  {isAiLoading && (
                    <div className="mt-2 p-3 bg-blue-50/50 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/40 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 animate-spin" />
                      <span>Trợ lý Gemini đang phân tích ngữ nghĩa, phiên âm và họ từ cho "{card.term}"...</span>
                    </div>
                  )}

                  {(() => {
                    const sug = aiSuggestions[idx];
                    if (!sug) return null;
                    const senses = Array.isArray(sug.senses) ? sug.senses : [];
                    const firstSense = senses[0];

                    return (
                      <div className="mt-2.5 p-3.5 bg-blue-50/70 dark:bg-blue-950/40 rounded-2xl border border-blue-200 dark:border-blue-800/80 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/50 pb-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800 dark:text-blue-300">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            <span>Đề xuất AI cho "{sug.term}"</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => applyAllAiSuggestions(idx)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all"
                          >
                            <Check className="w-3 h-3" />
                            <span>Áp dụng tất cả đề xuất vào thẻ</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {/* Gợi ý Nghĩa tiếng Việt & Từ loại */}
                          <div className="p-2.5 bg-white dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700/70 space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 block">
                              Nghĩa tiếng Việt & Loại từ (click để áp dụng):
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {senses.map((s, sIdx) => (
                                <button
                                  key={sIdx}
                                  type="button"
                                  onClick={() => {
                                    updateCardField(idx, 'meaning_vi', s.meaning_vi);
                                    if (s.pos) updateCardField(idx, 'part_of_speech', s.pos);
                                    if (s.phonetic) updateCardField(idx, 'phonetic', s.phonetic);
                                  }}
                                  className="px-2 py-1 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200 rounded-lg text-[11px] font-medium text-left border border-blue-100 dark:border-blue-800"
                                >
                                  <span className="font-semibold italic text-blue-600 dark:text-blue-400">[{s.pos || 'từ'}]</span> {s.meaning_vi}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Phiên âm IPA & Nhóm họ từ */}
                          <div className="p-2.5 bg-white dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700/70 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-500">Phiên âm:</span>
                              <button
                                type="button"
                                onClick={() => updateCardField(idx, 'phonetic', sug.phonetic || firstSense?.phonetic || '')}
                                className="font-mono text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                              >
                                {sug.phonetic || firstSense?.phonetic || 'Chưa rõ'}
                              </button>
                            </div>

                            {Array.isArray(sug.word_family) && sug.word_family.length > 0 && (
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                                  Nhóm họ từ (click để chọn):
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {sug.word_family.map((wf, wfIdx) => (
                                    <button
                                      key={wfIdx}
                                      type="button"
                                      onClick={() => updateCardField(idx, 'group_name', wf)}
                                      className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded text-[11px]"
                                    >
                                      {wf}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Định nghĩa tiếng Anh & Ví dụ */}
                          {firstSense?.definition_en && (
                            <div className="p-2.5 bg-white dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700/70 sm:col-span-2 space-y-1.5">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block">Định nghĩa tiếng Anh (click để điền):</span>
                                <p
                                  onClick={() => updateCardField(idx, 'definition_en', firstSense.definition_en)}
                                  className="text-slate-700 dark:text-slate-300 italic cursor-pointer hover:text-blue-600 text-xs"
                                >
                                  "{firstSense.definition_en}"
                                </p>
                              </div>

                              {firstSense?.examples?.[0] && (
                                <div>
                                  <span className="text-[11px] font-semibold text-slate-500 block">Câu ví dụ (click để điền):</span>
                                  <p
                                    onClick={() => updateCardField(idx, 'example', firstSense.examples[0])}
                                    className="text-slate-700 dark:text-slate-300 cursor-pointer hover:text-blue-600 text-xs"
                                  >
                                    {firstSense.examples[0]}
                                  </p>
                                </div>
                              )}

                              {/* Đồng nghĩa / Trái nghĩa */}
                              <div className="flex flex-wrap gap-4 pt-1.5 border-t border-slate-100 dark:border-slate-700 text-[11px]">
                                {Array.isArray(firstSense.synonyms) && firstSense.synonyms.length > 0 && (
                                  <span>
                                    Đồng nghĩa:{' '}
                                    <strong
                                      onClick={() => updateCardField(idx, 'synonyms', firstSense.synonyms.map((s: any) => typeof s === 'string' ? s : s.word).join('; '))}
                                      className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline"
                                    >
                                      {firstSense.synonyms.map((s: any) => typeof s === 'string' ? s : s.word).join(', ')}
                                    </strong>
                                  </span>
                                )}
                                {Array.isArray(firstSense.antonyms) && firstSense.antonyms.length > 0 && (
                                  <span>
                                    Trái nghĩa:{' '}
                                    <strong
                                      onClick={() => updateCardField(idx, 'antonyms', firstSense.antonyms.join('; '))}
                                      className="text-red-500 cursor-pointer hover:underline"
                                    >
                                      {firstSense.antonyms.join(', ')}
                                    </strong>
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Complete Card Fields Display (IPA, POS, Word Family, Definition, Example, Synonyms, Antonyms) */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Phiên âm IPA
                        </label>
                        <input
                          type="text"
                          value={card.phonetic}
                          onChange={e => updateCardField(idx, 'phonetic', e.target.value)}
                          placeholder="/ækˈsɛpt/"
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Loại từ (Part of Speech)
                        </label>
                        <input
                          type="text"
                          value={card.part_of_speech}
                          onChange={e => updateCardField(idx, 'part_of_speech', e.target.value)}
                          placeholder="verb, noun, adj..."
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Nhóm họ từ (Word Family / Group)
                        </label>
                        <input
                          type="text"
                          value={card.group_name}
                          onChange={e => updateCardField(idx, 'group_name', e.target.value)}
                          placeholder="accept, acceptable, acceptance..."
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Định nghĩa tiếng Anh (English Definition)
                      </label>
                      <input
                        type="text"
                        value={card.definition_en}
                        onChange={e => updateCardField(idx, 'definition_en', e.target.value)}
                        placeholder="to receive something willingly"
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Câu ví dụ (Example sentence)
                      </label>
                      <input
                        type="text"
                        value={card.example}
                        onChange={e => updateCardField(idx, 'example', e.target.value)}
                        placeholder="She accepted the job offer with enthusiasm."
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Từ đồng nghĩa (phân cách bằng dấu chấm phẩy ;)
                        </label>
                        <input
                          type="text"
                          value={card.synonyms}
                          onChange={e => updateCardField(idx, 'synonyms', e.target.value)}
                          placeholder="receive; agree; take"
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Từ trái nghĩa (phân cách bằng dấu chấm phẩy ;)
                        </label>
                        <input
                          type="text"
                          value={card.antonyms}
                          onChange={e => updateCardField(idx, 'antonyms', e.target.value)}
                          placeholder="reject; decline"
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleAddCard}
              className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 rounded-2xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-blue-600 flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm thẻ từ vựng mới</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
