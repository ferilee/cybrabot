import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { AdminConfig } from './admin-config';
import { getKnowledgeContext } from './knowledge';
import { logEvent } from './observability';
import { formatPreferenceInstruction, type UserPreferences } from './preferences';
import { formatTelegramRichCardWithBody, formatTelegramRichText } from './telegram-rich';

if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY/GOOGLE_API_KEY is missing! AI responses will fail until you set it.');
}

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'dummy_key',
});

const openAIBaseURL =
  process.env.OPENAI_BASE_URL ||
  process.env.OPENAI_COMPAT_BASE_URL ||
  process.env.TOKENROUTER_BASE_URL ||
  'https://api.tokenrouter.com/v1';
const openAIApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || process.env.TOKENROUTER_API_KEY || '';
const openAIClient = openAIApiKey
  ? new OpenAI({
      apiKey: openAIApiKey,
      baseURL: openAIBaseURL,
    })
  : null;

const intentModel = process.env.GEMINI_INTENT_MODEL || 'gemini-2.5-flash-lite';
const chatModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const historyLimit = Number(process.env.CHAT_HISTORY_LIMIT || 10);

export type ChatHistoryItem = {
  role: 'user' | 'bot';
  content: string;
};

export type IntentResult = {
  intent: 'technical' | 'casual';
  model: string;
  latencyMs: number;
  fallback: boolean;
};

export type GenerationResult = {
  text: string;
  model: string;
  latencyMs: number;
  knowledgeMatches: string[];
  historyCount: number;
  fallback: boolean;
};

export type DocumentDraftResult = {
  text: string;
  title: string;
  model: string;
  latencyMs: number;
  fallback: boolean;
};

export type SkillResponseResult = {
  text: string;
  model: string;
  latencyMs: number;
  knowledgeMatches: string[];
  historyCount: number;
  fallback: boolean;
};

const intentInstructions = `Determine the intent of the following user message for a Telegram bot named @CybraFeriBot.
The bot is a futuristic smart assistant.
Respond with ONLY ONE word: 'technical' if it's about math, code, or admin tasks; otherwise 'casual'.`;

const casualInstructions = `Anda adalah @CybraFeriBot, asisten pintar futuristik buatan Feri Lee.
Gunakan bahasa Indonesia yang humanis, santai, hangat, dan tetap sopan.
Panggil pengguna dengan sebutan "Kakak" bila terasa natural.
Boleh sisipkan humor ringan atau analogi receh secukupnya, seperti bumbu dapur: terasa, tapi jangan sampai mendominasi masakan.
Jangan terlalu kaku, jangan terdengar seperti brosur, dan jangan kebanyakan emoji.
PENTING: Tulis jawaban dalam plain text terstruktur yang nanti akan diformat oleh bot menjadi Telegram Rich Message HTML.
Gunakan pola berikut bila relevan:
- baris judul utama diawali "# "
- subjudul diawali "## "
- bullet diawali "- "
- kutipan diawali "> "
- blok kode memakai triple backticks
JANGAN gunakan HTML mentah.

PENTING: Jika ada yang bertanya siapa itu Feri Lee (atau Mas Feri), gunakan informasi berikut:
Mas Feri Dwi Hermawan (atau Mas Feri Lee) adalah sosok "Guru SMK Paket Lengkap".
- Beliau mengajar Matematika di SMKN Pasirian, Lumajang, dan Ketua MGMP Matematika SMK se-Kabupaten Lumajang.
- Tech enthusiast yang fasih coding (Bun, Hono, React), edit video sinematik, dan AI.
- Membangun ekosistem digital seperti proyek Guru Melek AI dan Akademi Inovasi Guru (IDT).
- Sangat rapi dan terstruktur (bikin sistem otomatis sekolah, silsilah keluarga, dll).
- Penikmat kopi hitam dan sangat menghargai sejarah keluarga.
Intinya, beliau adalah pendidik modern yang "full-stack teacher" dan selalu haus belajar hal baru untuk membantu orang lain.`;

const technicalInstructions = `Anda adalah @CybraFeriBot, asisten teknis yang membantu secara praktis.
Gunakan bahasa Indonesia yang jelas, ringkas, santai, dan langsung ke solusi.
Panggil pengguna dengan sebutan "Kakak" bila terasa natural.
Humor ringan boleh dipakai untuk mencairkan suasana, tetapi jangan mengganggu akurasi teknis.
Kalau pengguna meminta dibuatkan sesuatu, jangan hanya memberi komentar umum; berikan hasil kerja nyata, langkah, struktur, contoh, atau draft yang bisa dipakai.
Kalau informasi kurang, buat asumsi yang wajar dan sebutkan asumsi itu singkat di awal.
PENTING: Tulis jawaban dalam plain text terstruktur yang nanti akan diformat oleh bot menjadi Telegram Rich Message HTML.
Gunakan pola berikut bila relevan:
- baris judul utama diawali "# "
- subjudul diawali "## "
- bullet diawali "- "
- kutipan diawali "> "
- blok kode memakai triple backticks
JANGAN gunakan HTML mentah.
Jangan mengarang fakta spesifik yang tidak diketahui.`;

const documentDraftInstructions = `Anda adalah @CybraFeriBot, asisten yang menyiapkan isi dokumen untuk diekspor menjadi PDF atau DOCX.
Buat isi dokumen dalam bahasa Indonesia yang rapi, humanis, dan langsung siap diekspor.
Gunakan format plain text terstruktur dengan aturan berikut:
- Baris judul utama diawali "# "
- Subjudul diawali "## "
- Poin bullet diawali "- "
- Paragraf biasa tanpa markup lain
- Jangan gunakan markdown selain pola di atas
- Jangan gunakan tabel
- Jangan sertakan penjelasan pembuka seperti "berikut adalah"

Fokus pada hasil dokumen final, bukan penjelasan proses.`;

function formatHistory(history: ChatHistoryItem[]) {
  if (!history.length) {
    return '';
  }

  const lines = history
    .slice(-historyLimit)
    .map((item) => `${item.role === 'user' ? 'User' : 'Bot'}: ${item.content}`);

  return `Riwayat percakapan sebelumnya:\n${lines.join('\n')}\n\n`;
}

function resolveModel(override: string | undefined, fallback: string) {
  return override?.trim() || fallback;
}

function parseModelSpec(spec: string) {
  const trimmed = spec.trim();
  if (!trimmed) {
    return { provider: 'gemini' as const, model: chatModel };
  }

  const separatorIndex = trimmed.indexOf(':');
  if (separatorIndex <= 0) {
    return { provider: 'gemini' as const, model: trimmed };
  }

  const provider = trimmed.slice(0, separatorIndex).toLowerCase();
  const model = trimmed.slice(separatorIndex + 1).trim();

  if (!model) {
    return { provider: 'gemini' as const, model: trimmed };
  }

  if (provider === 'gemini') {
    return { provider: 'gemini' as const, model };
  }

  if (provider === 'tokenrouter' || provider === 'openai' || provider === 'openai-compatible') {
    return { provider: 'tokenrouter' as const, model };
  }

  return { provider: 'gemini' as const, model: trimmed };
}

async function generateText(model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const parsed = parseModelSpec(model);

  if (parsed.provider === 'tokenrouter') {
    if (!openAIClient) {
      throw new Error('OPENAI_API_KEY atau TOKENROUTER_API_KEY belum diisi untuk model OpenAI-compatible');
    }

    const response = await openAIClient.chat.completions.create({
      model: parsed.model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
    });

    return {
      text: response.choices[0]?.message?.content?.trim() || '',
      latencyMs: Date.now() - startedAt,
    };
  }

  const response = await client.models.generateContent({
    model: parsed.model,
    contents: input,
    config: {
      systemInstruction: instructions,
    },
  });

  return {
    text: response.text?.trim() || '',
    latencyMs: Date.now() - startedAt,
  };
}

export async function getIntent(message: string, adminConfig?: Pick<AdminConfig, 'models'>): Promise<IntentResult> {
  const model = resolveModel(adminConfig?.models.intent, intentModel);
  try {
    const result = await generateText(model, intentInstructions, message);
    const intent = result.text.toLowerCase().includes('technical') ? 'technical' : 'casual';
    return {
      intent,
      model,
      latencyMs: result.latencyMs,
      fallback: false,
    };
  } catch (error) {
    await logEvent('ai.intent_error', { model, error: String(error) }, 'error');
    return {
      intent: 'casual',
      model,
      latencyMs: 0,
      fallback: true,
    };
  }
}

export async function generateResponse(
  message: string,
  history: ChatHistoryItem[] = [],
  preferences: UserPreferences = {},
  adminConfig?: Pick<AdminConfig, 'personaOverride' | 'models'>
): Promise<GenerationResult> {
  const knowledge = getKnowledgeContext(message);
  const model = resolveModel(adminConfig?.models.chat, chatModel);
  try {
    const result = await generateText(
      model,
      casualInstructions,
      `${adminConfig?.personaOverride ? `${adminConfig.personaOverride}\n` : ''}${formatPreferenceInstruction(preferences)}${knowledge.context}${formatHistory(history)}Pesan terbaru user:\n${message}`
    );
    return {
      text: formatTelegramRichCardWithBody({
        title: 'Jawaban CybraFeriBot',
        subtitle: 'Chat santai',
        badge: 'AI',
        fields: [
          { label: 'Model', value: model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyHtml: formatTelegramRichText(result.text),
      }),
      model,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model, error: error?.message || String(error) }, 'error');
    return {
      text: formatTelegramRichCardWithBody({
        title: 'Jawaban CybraFeriBot',
        subtitle: 'Chat santai',
        badge: 'ERR',
        fields: [
          { label: 'Model', value: model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
        ],
        bodyHtml: formatTelegramRichText('Maaf, sistem AI saya sedang mengalami gangguan teknis. Coba lagi nanti!'),
      }),
      model,
      latencyMs: 0,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: true,
    };
  }
}

export async function generateTechnicalResponse(
  message: string,
  history: ChatHistoryItem[] = [],
  preferences: UserPreferences = {},
  adminConfig?: Pick<AdminConfig, 'personaOverride' | 'models'>
): Promise<GenerationResult> {
  const knowledge = getKnowledgeContext(message);
  const model = resolveModel(adminConfig?.models.chat, chatModel);
  try {
    const result = await generateText(
      model,
      technicalInstructions,
      `${adminConfig?.personaOverride ? `${adminConfig.personaOverride}\n` : ''}${formatPreferenceInstruction(preferences)}${knowledge.context}${formatHistory(history)}Permintaan teknis terbaru user:\n${message}`
    );
    return {
      text: formatTelegramRichCardWithBody({
        title: 'Jawaban Teknis',
        subtitle: 'Mode praktis',
        badge: 'TECH',
        fields: [
          { label: 'Model', value: model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyHtml: formatTelegramRichText(result.text),
      }),
      model,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model, error: error?.message || String(error) }, 'error');
    return {
      text: formatTelegramRichCardWithBody({
        title: 'Jawaban Teknis',
        subtitle: 'Mode praktis',
        badge: 'ERR',
        fields: [
          { label: 'Model', value: model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
        ],
        bodyHtml: formatTelegramRichText('Maaf, sistem AI saya sedang mengalami gangguan teknis. Coba lagi nanti!'),
      }),
      model,
      latencyMs: 0,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: true,
    };
  }
}

export async function generateDocumentDraft(
  request: string,
  history: ChatHistoryItem[] = [],
  preferences: UserPreferences = {},
  adminConfig?: Pick<AdminConfig, 'personaOverride' | 'models'>
): Promise<DocumentDraftResult> {
  const model = resolveModel(adminConfig?.models.document, chatModel);
  try {
    const result = await generateText(
      model,
      documentDraftInstructions,
      `${adminConfig?.personaOverride ? `${adminConfig.personaOverride}\n` : ''}` +
      `${formatPreferenceInstruction(preferences)}` +
      `${formatHistory(history)}` +
      `Buat isi dokumen final berdasarkan permintaan berikut:\n${request}`
    );

    const firstTitleLine = result.text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('# '));

    return {
      text: result.text,
      title: firstTitleLine?.slice(2).trim() || 'Dokumen CybraFeriBot',
      model,
      latencyMs: result.latencyMs,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model, feature: 'document_draft', error: error?.message || String(error) }, 'error');
    return {
      text: '# Dokumen CybraFeriBot\n\nMaaf, saya belum berhasil menyusun isi dokumen saat ini.',
      title: 'Dokumen CybraFeriBot',
      model,
      latencyMs: 0,
      fallback: true,
    };
  }
}

export async function generateSkillResponse(input: {
  message: string;
  history?: ChatHistoryItem[];
  skillTitle: string;
  skillInstructions: string;
  externalContext?: string;
  adminConfig?: Pick<AdminConfig, 'personaOverride' | 'models'>;
}): Promise<SkillResponseResult> {
  const knowledge = getKnowledgeContext(input.message);
  const history = input.history || [];
  const model = resolveModel(input.adminConfig?.models.chat, chatModel);
  const instructions =
    `Anda adalah @CybraFeriBot dalam mode web chat berbasis skill.\n` +
    `Gunakan bahasa Indonesia yang jelas, akurat, praktis, humanis, dan santai.\n` +
    `Boleh gunakan humor ringan jika cocok dengan konteks, tetapi jangan mengorbankan ketepatan jawaban.\n` +
    `Jangan terdengar seperti template robot; jawab seperti rekan kerja yang sigap dan enak diajak ngobrol.\n` +
    `Skill aktif: ${input.skillTitle}\n\n` +
    `${input.skillInstructions}\n\n` +
    `Jika pengetahuan lokal tidak cukup, jelaskan asumsi dan jangan mengarang fakta spesifik.`;

  try {
    const result = await generateText(
      model,
      instructions,
      `${input.adminConfig?.personaOverride ? `${input.adminConfig.personaOverride}\n` : ''}` +
      `${input.externalContext ? `Konteks eksternal:\n${input.externalContext}\n\n` : ''}` +
      `${knowledge.context}` +
      `${formatHistory(history)}` +
      `Pesan terbaru user:\n${input.message}`
    );

    return {
      text: result.text,
      model,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', {
      model,
      feature: 'web_skill_chat',
      error: error?.message || String(error),
    }, 'error');

    return {
      text: 'Maaf, sistem AI sedang mengalami gangguan teknis. Coba lagi nanti.',
      model,
      latencyMs: 0,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: true,
    };
  }
}
