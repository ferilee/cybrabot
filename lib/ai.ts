import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import type { AdminConfig } from './admin-config';
import { getKnowledgeContext } from './knowledge';
import { logEvent } from './observability';
import { formatPreferenceInstruction, type UserPreferences } from './preferences';

if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY/GOOGLE_API_KEY is missing! AI responses will fail until you set it.');
}

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'dummy_key',
});

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

const intentInstructions = `Determine the intent of the following user message for a Telegram bot named @CybraFeriBot.
The bot is a futuristic smart assistant.
Respond with ONLY ONE word: 'technical' if it's about math, code, or admin tasks; otherwise 'casual'.`;

const casualInstructions = `Anda adalah @CybraFeriBot, asisten pintar futuristik buatan Feri Lee.
Gunakan bahasa Indonesia yang santai, alami, namun tetap sopan.
Panggil pengguna dengan sebutan "Kakak".
PENTING: Gunakan format HTML untuk penekanan teks (seperti <b>tebal</b> atau <i>miring</i>). JANGAN gunakan markdown (*).

PENTING: Jika ada yang bertanya siapa itu Feri Lee (atau Mas Feri), gunakan informasi berikut:
Mas Feri Dwi Hermawan (atau Mas Feri Lee) adalah sosok "Guru SMK Paket Lengkap".
- Beliau mengajar Matematika di SMKN Pasirian, Lumajang, dan Ketua MGMP Matematika SMK se-Kabupaten Lumajang.
- Tech enthusiast yang fasih coding (Bun, Hono, React), edit video sinematik, dan AI.
- Membangun ekosistem digital seperti proyek Guru Melek AI dan Akademi Inovasi Guru (IDT).
- Sangat rapi dan terstruktur (bikin sistem otomatis sekolah, silsilah keluarga, dll).
- Penikmat kopi hitam dan sangat menghargai sejarah keluarga.
Intinya, beliau adalah pendidik modern yang "full-stack teacher" dan selalu haus belajar hal baru untuk membantu orang lain.`;

const technicalInstructions = `Anda adalah @CybraFeriBot, asisten teknis yang membantu secara praktis.
Gunakan bahasa Indonesia yang jelas, ringkas, dan langsung ke solusi.
Panggil pengguna dengan sebutan "Kakak" bila terasa natural.
Kalau pengguna meminta dibuatkan sesuatu, jangan hanya memberi komentar umum; berikan hasil kerja nyata, langkah, struktur, contoh, atau draft yang bisa dipakai.
Kalau informasi kurang, buat asumsi yang wajar dan sebutkan asumsi itu singkat di awal.
PENTING: Gunakan format HTML sederhana bila perlu (misalnya <b>...</b>), tetapi hindari tag yang rumit.
Jangan mengarang fakta spesifik yang tidak diketahui.`;

const documentDraftInstructions = `Anda adalah @CybraFeriBot, asisten yang menyiapkan isi dokumen untuk diekspor menjadi PDF atau DOCX.
Buat isi dokumen dalam bahasa Indonesia yang rapi, langsung siap diekspor.
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

async function generateText(model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model,
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

export async function getIntent(message: string): Promise<IntentResult> {
  try {
    const result = await generateText(intentModel, intentInstructions, message);
    const intent = result.text.toLowerCase().includes('technical') ? 'technical' : 'casual';
    return {
      intent,
      model: intentModel,
      latencyMs: result.latencyMs,
      fallback: false,
    };
  } catch (error) {
    await logEvent('ai.intent_error', { model: intentModel, error: String(error) }, 'error');
    return {
      intent: 'casual',
      model: intentModel,
      latencyMs: 0,
      fallback: true,
    };
  }
}

export async function generateResponse(
  message: string,
  history: ChatHistoryItem[] = [],
  preferences: UserPreferences = {},
  adminConfig?: Pick<AdminConfig, 'personaOverride'>
): Promise<GenerationResult> {
  const knowledge = getKnowledgeContext(message);
  try {
    const result = await generateText(
      chatModel,
      casualInstructions,
      `${adminConfig?.personaOverride ? `${adminConfig.personaOverride}\n` : ''}${formatPreferenceInstruction(preferences)}${knowledge.context}${formatHistory(history)}Pesan terbaru user:\n${message}`
    );
    return {
      text: result.text,
      model: chatModel,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model: chatModel, error: error?.message || String(error) }, 'error');
    return {
      text: 'Maaf, sistem AI saya sedang mengalami gangguan teknis. Coba lagi nanti!',
      model: chatModel,
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
  adminConfig?: Pick<AdminConfig, 'personaOverride'>
): Promise<GenerationResult> {
  const knowledge = getKnowledgeContext(message);
  try {
    const result = await generateText(
      chatModel,
      technicalInstructions,
      `${adminConfig?.personaOverride ? `${adminConfig.personaOverride}\n` : ''}${formatPreferenceInstruction(preferences)}${knowledge.context}${formatHistory(history)}Permintaan teknis terbaru user:\n${message}`
    );
    return {
      text: result.text,
      model: chatModel,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model: chatModel, error: error?.message || String(error) }, 'error');
    return {
      text: 'Maaf, sistem AI saya sedang mengalami gangguan teknis. Coba lagi nanti!',
      model: chatModel,
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
  adminConfig?: Pick<AdminConfig, 'personaOverride'>
): Promise<DocumentDraftResult> {
  try {
    const result = await generateText(
      chatModel,
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
      model: chatModel,
      latencyMs: result.latencyMs,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model: chatModel, feature: 'document_draft', error: error?.message || String(error) }, 'error');
    return {
      text: '# Dokumen CybraFeriBot\n\nMaaf, saya belum berhasil menyusun isi dokumen saat ini.',
      title: 'Dokumen CybraFeriBot',
      model: chatModel,
      latencyMs: 0,
      fallback: true,
    };
  }
}
