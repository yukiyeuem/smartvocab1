import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { db } from './db';

dotenv.config();

const PROMPT_VERSION = 'v4.3';
const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

export interface SenseResult {
  pos: string;
  meaning_vi: string;
  definition_en: string;
  phonetic: string;
  examples: string[];
  synonyms: Array<{ word: string; note_vi?: string }>;
  antonyms: string[];
}

export interface DictionaryLookupResult {
  term: string;
  lemma: string;
  phonetic: string;
  word_family?: string[];
  group_name?: string;
  senses: SenseResult[];
}

export interface ReadingResult {
  title: string;
  passage: string;
  level: string;
  topic: string;
  used_forms: Array<{ lemma: string; form: string }>;
  questions: Array<{
    question: string;
    options: string[];
    answer_index: number;
    explanation: string;
  }>;
}

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

export class AiProvider {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Chưa cấu hình GEMINI_API_KEY trên máy chủ.');
    }
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey,
      });
    }
    return this.client;
  }

  public isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY && !db.getAppSettings().ai_kill_switch;
  }

  private async generateWithFallback(prompt: string): Promise<{ text: string; modelUsed: string }> {
    const client = this.getClient();

    if (db.getAppSettings().ai_kill_switch) {
      throw new Error('Tính năng AI tạm thời được tắt bởi Quản trị viên.');
    }

    let lastError: any = null;

    for (const model of CANDIDATE_MODELS) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.text?.trim() || '';
        if (text) {
          return { text, modelUsed: model };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[AI] Model ${model} failed with: ${err.message || err}. Trying next fallback...`);
      }
    }

    throw new Error(
      lastError?.message?.includes('demand')
        ? 'Máy chủ AI Google đang quá tải tạm thời. Vui lòng thử lại sau giây lát.'
        : lastError?.message || 'Không thể kết nối đến dịch vụ AI.'
    );
  }

  public async lookup(term: string): Promise<{ data: DictionaryLookupResult; fromCache: boolean }> {
    const normalizedTerm = term.trim().toLowerCase();
    const cacheKey = `${normalizedTerm}:${PROMPT_VERSION}`;

    // 1. Check shared cache
    const cache = db.getDictionaryCache();
    const cachedItem = cache.find(c => c.cache_key === cacheKey && c.expires_at > Date.now());
    if (cachedItem) {
      return { data: cachedItem.payload, fromCache: true };
    }

    const prompt = `Tra cứu từ vựng tiếng Anh sau cho người học Việt Nam: "${normalizedTerm}".
Phân tích chi tiết:
1. Dạng nguyên thể (lemma) và nhóm họ từ liên quan (word_family: ví dụ accept -> ["accept", "acceptable", "acceptance", "acceptability", "unacceptable"], group_name: root word).
2. Phiên âm IPA chuẩn quốc tế (phonetic: ví dụ /ækˈsɛpt/).
3. Danh sách các nghĩa phổ biến nhất (senses): từ loại (pos: noun, verb, adj, adv...), nghĩa tiếng Việt chuẩn xác tự nhiên (meaning_vi), định nghĩa tiếng Anh súc tích (definition_en), câu ví dụ hay (examples), từ đồng nghĩa cùng loại từ (synonyms: word và note_vi ngắn gọn), và từ trái nghĩa (antonyms).
Chỉ trả về định dạng JSON hợp lệ tuân theo cấu trúc sau:
{
  "term": "${normalizedTerm}",
  "lemma": "dạng nguyên thể",
  "phonetic": "phiên âm IPA chung",
  "group_name": "gốc từ chung",
  "word_family": ["từ 1", "từ 2", "từ 3"],
  "senses": [
    {
      "pos": "verb",
      "meaning_vi": "nghĩa tiếng Việt",
      "definition_en": "concise English definition",
      "phonetic": "/.../",
      "examples": ["Ví dụ thực tế..."],
      "synonyms": [{"word": "synonym", "note_vi": "sắc thái nghĩa"}],
      "antonyms": ["antonym"]
    }
  ]
}`;

    const { text, modelUsed } = await this.generateWithFallback(prompt);
    const cleaned = cleanJsonText(text);

    let parsed: DictionaryLookupResult;
    try {
      parsed = JSON.parse(cleaned);
      if (!parsed.term) parsed.term = normalizedTerm;
      if (!Array.isArray(parsed.senses) || parsed.senses.length === 0) {
        throw new Error('Thiếu danh sách nghĩa');
      }
    } catch {
      throw new Error('Phản hồi từ mô hình AI không đúng định dạng JSON.');
    }

    // Cache for 30 days
    db.getDictionaryCache().push({
      cache_key: cacheKey,
      payload: parsed,
      model: modelUsed,
      prompt_version: PROMPT_VERSION,
      created_at: Date.now(),
      expires_at: Date.now() + 30 * 86400000,
    });
    db.scheduleSave();

    return { data: parsed, fromCache: false };
  }

  public async generateReading(
    words: string[],
    level: string = 'B1',
    topic?: string
  ): Promise<ReadingResult> {
    const wordsList = words.slice(0, 8).join(', ');
    const chosenTopic = topic && topic.trim() ? topic.trim() : 'Daily life, technology and modern society';

    const prompt = `Bạn là chuyên gia giảng dạy tiếng Anh. Hãy viết một bài đọc ngắn (150-250 từ) cấp độ CEFR ${level} xoay quanh chủ đề "${chosenTopic}".
Yêu cầu BẮT BUỘC:
1. Bài đọc PHẢI chứa và làm nổi bật tất cả các từ vựng mục tiêu sau: [${wordsList}].
2. Ngữ pháp và từ vựng tự nhiên, mạch lạc, dễ hiểu theo cấp độ ${level}.
3. Soạn 3 đến 4 câu hỏi trắc nghiệm đọc hiểu (4 lựa chọn A, B, C, D) có đáp án đúng (answer_index từ 0 đến 3) và giải thích ngắn gọn bằng tiếng Việt.
Trả về DUY NHẤT định dạng JSON tuân thủ cấu trúc sau:
{
  "title": "Tiêu đề bài đọc tiếng Anh",
  "passage": "Nội dung bài đọc tiếng Anh chứa đầy đủ các từ trong danh sách...",
  "level": "${level}",
  "topic": "${chosenTopic}",
  "used_forms": [
    {"lemma": "target_word", "form": "từ xuất hiện trong bài"}
  ],
  "questions": [
    {
      "question": "Câu hỏi trắc nghiệm tiếng Anh?",
      "options": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "answer_index": 0,
      "explanation": "Giải thích ngắn vì sao đáp án này đúng (tiếng Việt)"
    }
  ]
}`;

    const { text } = await this.generateWithFallback(prompt);
    const cleaned = cleanJsonText(text);

    let parsed: ReadingResult;
    try {
      parsed = JSON.parse(cleaned);
      if (!parsed.passage || !Array.isArray(parsed.questions)) {
        throw new Error('Dữ liệu bài đọc thiếu các trường bắt buộc');
      }
    } catch {
      throw new Error('Không thể phân tích dữ liệu bài đọc từ AI.');
    }

    return parsed;
  }
}

export const aiProvider = new AiProvider();
