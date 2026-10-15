import React, { useState } from 'react';
import { Search, Sparkles, Volume2, Plus, Check, Bookmark, AlertCircle, RotateCw } from 'lucide-react';
import { Deck, DictionaryLookupResult, SenseResult } from '../types';
import { apiRequest } from '../lib/api';
import { speakEnglish } from '../lib/speech';

interface DictionaryPanelProps {
  decks: Deck[];
  onCardAddedToDeck: () => void;
}

export const DictionaryPanel: React.FC<DictionaryPanelProps> = ({
  decks,
  onCardAddedToDeck,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DictionaryLookupResult | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [savedSenseIdx, setSavedSenseIdx] = useState<number | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string>(decks[0]?.id || '');

  const handleLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setSavedSenseIdx(null);

    try {
      const res = await apiRequest<{ success: boolean; data?: DictionaryLookupResult; fromCache?: boolean; senses?: any[] }>(
        '/api/dictionary/lookup',
        {
          method: 'POST',
          body: JSON.stringify({ term: searchTerm.trim() }),
        }
      );
      const data = res.data || (res.senses ? (res as any) : null);
      setResult(data);
      setFromCache(Boolean(res.fromCache));
    } catch (err: any) {
      setError(err.message || 'Không thể tra cứu từ vựng với AI.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSense = async (sense: SenseResult, senseIdx: number) => {
    if (!selectedDeckId) {
      setError('Vui lòng chọn hoặc tạo ít nhất một bộ thẻ trước khi lưu.');
      return;
    }

    try {
      await apiRequest(`/api/decks/${selectedDeckId}/cards`, {
        method: 'POST',
        body: JSON.stringify({
          term: result!.term,
          meaning_vi: sense.meaning_vi,
          definition_en: sense.definition_en,
          phonetic: sense.phonetic || result!.phonetic,
          part_of_speech: sense.pos,
          synonyms: sense.synonyms.map(s => (typeof s === 'string' ? s : s.word)),
          antonyms: sense.antonyms,
          example: sense.examples[0] || '',
          group_name: result!.lemma || result!.term,
        }),
      });

      setSavedSenseIdx(senseIdx);
      onCardAddedToDeck();
      setTimeout(() => setSavedSenseIdx(null), 2500);
    } catch (err: any) {
      setError(err.message || 'Không thể lưu thẻ vào bộ.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Search Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="max-w-xl mx-auto text-center mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-full text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Trợ lý Từ điển Gemini AI</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            Tra từ vựng & Tự động tạo Thẻ học
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Phân tích ngữ nghĩa, phân loại từ, phiên âm IPA quốc tế, câu ví dụ và từ đồng/trái nghĩa chuẩn xác
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleLookup} className="max-w-xl mx-auto flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Nhập từ vựng tiếng Anh (ví dụ: perseverance, resilient...)"
              className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium text-slate-900 dark:text-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !searchTerm.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-semibold shadow-xs flex items-center gap-2 transition-all disabled:opacity-40"
          >
            {loading ? <RotateCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{loading ? 'Đang tra...' : 'Tra từ'}</span>
          </button>
        </form>

        {/* Deck Target Selector */}
        {decks.length > 0 && (
          <div className="max-w-xl mx-auto mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>Lưu từ mới vào bộ:</span>
            <select
              value={selectedDeckId}
              onChange={e => setSelectedDeckId(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
            >
              {decks.map(d => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl text-red-700 dark:text-red-300 text-xs flex items-start gap-2 max-w-xl mx-auto">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Lookup Result Display */}
      {result && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm">
          {/* Term Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {result.term}
                </h1>
                <button
                  type="button"
                  onClick={() => speakEnglish(result.term)}
                  className="p-2 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>

              {result.phonetic && (
                <span className="text-sm font-mono text-slate-400 mt-1 block">
                  {result.phonetic}
                </span>
              )}

              {result.word_family && result.word_family.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap text-xs text-slate-500">
                  <span className="font-semibold text-slate-400">Họ từ:</span>
                  {result.word_family.map((wf, wfIdx) => (
                    <span
                      key={wfIdx}
                      className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md font-medium"
                    >
                      {wf}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-400 block">
                {fromCache ? 'Bộ nhớ đệm (0 token)' : 'Mô hình Gemini 3.8 Flash'}
              </span>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                AI gợi ý · Bạn có thể tinh chỉnh khi lưu
              </span>
            </div>
          </div>

          {/* Senses List */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Các tầng nghĩa phổ biến ({result.senses.length})
            </h3>

            {result.senses.map((sense, sIdx) => {
              const isSaved = savedSenseIdx === sIdx;

              return (
                <div
                  key={sIdx}
                  className="p-5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row md:items-start justify-between gap-4 group"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold rounded-md">
                        {sense.pos}
                      </span>
                      <h4 className="text-base font-bold text-slate-900 dark:text-white">
                        {sense.meaning_vi}
                      </h4>
                    </div>

                    {sense.definition_en && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 italic">
                        "{sense.definition_en}"
                      </p>
                    )}

                    {sense.examples && sense.examples.length > 0 && (
                      <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-400 block mb-0.5">Ví dụ:</span>
                        {sense.examples[0]}
                      </div>
                    )}

                    {(sense.synonyms.length > 0 || sense.antonyms.length > 0) && (
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 pt-1">
                        {sense.synonyms.length > 0 && (
                          <span>
                            Đồng nghĩa:{' '}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {sense.synonyms.map(s => (typeof s === 'string' ? s : `${s.word}${s.note_vi ? ` (${s.note_vi})` : ''}`)).join(', ')}
                            </strong>
                          </span>
                        )}
                        {sense.antonyms.length > 0 && (
                          <span>
                            Trái nghĩa:{' '}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {sense.antonyms.join(', ')}
                            </strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleSaveSense(sense, sIdx)}
                    disabled={isSaved}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 ${
                      isSaved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {isSaved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{isSaved ? 'Đã lưu vào bộ thẻ' : 'Lưu nghĩa này'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
