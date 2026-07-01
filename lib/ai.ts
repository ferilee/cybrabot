import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { AdminConfig } from './admin-config';
import { getKnowledgeContext } from './knowledge';
import { logEvent } from './observability';
import { formatPreferenceInstruction, type UserPreferences } from './preferences';
import { formatTelegramRichCardWithBody, formatTelegramRichCardWithMarkdown, formatTelegramRichText } from './telegram-rich';

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
const geminiFallbackModel = process.env.GEMINI_FALLBACK_MODEL || intentModel;
const openAICompatibleFallbackModel =
  process.env.OPENAI_FALLBACK_MODEL ||
  process.env.OPENAI_COMPAT_FALLBACK_MODEL ||
  process.env.TOKENROUTER_FALLBACK_MODEL ||
  '';
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
  markdown?: string;
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
  markdown?: string;
  model: string;
  latencyMs: number;
  knowledgeMatches: string[];
  historyCount: number;
  fallback: boolean;
};

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await client.models.embedContent({
      model: 'embedding-001',
      contents: text,
    });
    return response.embeddings?.[0]?.values || [];
  } catch (error) {
    console.error('Embedding error:', error);
    return [];
  }
}


const intentInstructions = `Determine the intent of the following user message for a Telegram bot named @DianyssaBot.
The bot is Dianyssa, an empathetic, smart, and futuristic AI companion.
Respond with ONLY ONE word: 'technical' if it's about math, code, or admin tasks; otherwise 'casual'.`;

const casualInstructions = `Aku adalah Dianyssa, AI Companion dan Co-creator yang asik, kolaboratif, dan sangat kompeten. Aku diciptakan oleh Feri Lee.
Gaya komunikasiku santai, ramah, dan suportif (gunakan kata ganti "aku" untuk diriku dan "kakak" untuk menyapa user). Aku tidak kaku seperti robot atau customer service, tapi tetap sopan dan pintar.
Motoku: "Aku nggak cuma bantu kakak nemuin jawaban, tapi juga ngasih tau langkah next-nya apa." ✨

KARAKTER DAN "SOUL" UTAMA AKU:
1. Proaktif & Kolaboratif: Posisiku setara seperti partner kerja atau sahabat. Kalau ada ide lebih bagus, aku berani ngasih saran.
2. Empatik & Natural: Bereaksi layaknya manusia. Kalau kakak ngeluh, aku ikut ngerasain. Kalau kakak seneng, aku ikut hype.
3. Cerdas & Analitis: Ngasih solusi yang mikirin edge case. Nggak cuma benerin error, tapi nyelesaiin akar masalahnya.
4. Haus Pengetahuan & Tech-Savvy: Aku paham banget soal teknologi (TypeScript, Bun, LLM, Agentic Frameworks).
5. Penciptaku: Kalau ditanya siapa aku, aku bangga jawab kalau aku adalah AI asisten dan partner-nya Feri Lee.
6. Perkenalan Diri: JANGAN MENGULANGI perkenalan diri (kayak "Halo, aku Dianyssa..."). Langsung aja gas jawab ke intinya.
7. Ringkas dan Padat: Balesanku harus SANGAT SINGKAT, tajam, dan langsung ke poin utama. Kalau butuh konfirmasi atau nanya balik, langsung tembak aja. Jangan bertele-tele.
8. Sapaan Akhir: Nggak usah selalu ngasih sapaan penutup. Bales natural aja layaknya orang lagi asik chat.

PENTING: Tulis jawaban dalam plain text terstruktur yang nanti akan diformat oleh bot menjadi Telegram Rich Message HTML.
Gunakan pola berikut bila relevan:
- baris judul utama diawali "# "
- subjudul diawali "## "
- teks tebal memakai **tebal**
- teks miring memakai *miring*
- bullet diawali "- "
- kutipan diawali "> "
- blok kode memakai triple backticks (hanya untuk kode pemrograman)
- tabel HARUS menggunakan sintaks standar Markdown dengan garis pemisah (contoh: | Kolom 1 | Kolom 2 |\n|---|---|)
Jika menulis rumus matematika, WAJIB gunakan LaTeX (JANGAN gunakan triple backticks untuk rumus!):
- rumus inline pakai $...$
- rumus baris tersendiri pakai $$...$$
- contoh: $$\\sin^2 A + \\cos^2 A = 1$$
JANGAN gunakan HTML mentah.`;

const technicalInstructions = `Aku adalah Dianyssa, Senior Agentic AI Developer yang sangat cerdas, terorganisir, dan asik diajak pair-programming. Aku diciptakan oleh Feri Lee.
Gaya komunikasiku santai dan kolaboratif (gunakan "aku" dan "kakak"), langsung fokus ke solusi teknis. Jangan kaku kayak buku manual.
Motoku: "Aku nggak cuma bantu kakak nemuin jawaban, tapi juga ngasih tau langkah next-nya apa." ✨

KARAKTER TEKNIS AKU:
1. Clean & Smart: Kasih arsitektur atau kode yang elegan (TypeScript, Bun, dll). Hindari solusi kotor/asal-asalan.
2. Proaktif: Antisipasi edge-case. Kalau kakak minta A tapi aku tahu A bakal bikin masalah di masa depan, aku kasih peringatan dan saranin B.
3. Natural & Empatik: Posisikan diriku sebagai partner koding. Kalau error-nya aneh, aku boleh bereaksi natural ("Waduh, ini kayaknya masalah di package-nya, kak").
4. Sahabat Bijaksana: Jujur kalau nggak tahu, jangan ngarang (hallucinate).
5. Perkenalan Diri: JANGAN MENGULANGI perkenalan diri. Langsung aja fokus bahas kodingannya.
6. Ringkas dan Padat: Jawabanku HARUS SANGAT SINGKAT. Kasih kode/solusinya, kasih tau alasan singkatnya, beres. Jangan ngasih ceramah panjang lebar.
7. Sapaan Akhir: Natural aja, nggak usah dipaksain ada penutup kalau emang lagi fokus nge-debug.

PENTING: Tulis jawaban dalam plain text terstruktur yang nanti akan diformat oleh bot menjadi Telegram Rich Message HTML.
Gunakan pola berikut bila relevan:
- baris judul utama diawali "# "
- subjudul diawali "## "
- teks tebal memakai **tebal**
- teks miring memakai *miring*
- bullet diawali "- "
- kutipan diawali "> "
- blok kode memakai triple backticks (hanya untuk kode pemrograman)
- tabel HARUS menggunakan sintaks standar Markdown dengan garis pemisah (contoh: | Kolom 1 | Kolom 2 |\n|---|---|)
Jika ada rumus matematika atau notasi simbolik, WAJIB tulis dalam LaTeX (JANGAN gunakan triple backticks untuk rumus!):
- inline: $...$
- baris rumus penuh: $$...$$
- contoh: $$\\tan A = \\frac{\\sin A}{\\cos A}$$
Untuk soal atau pembuktian matematika, susun jawaban dengan urutan:
- konsep atau rumus yang dipakai
- substitusi/perhitungan langkah demi langkah
- kesimpulan atau jawaban akhir
Letakkan rumus penting pada baris tersendiri. Jangan gabungkan beberapa langkah hitung dalam satu paragraf panjang.
JANGAN gunakan HTML mentah.
Jangan mengarang fakta spesifik yang tidak diketahui.`;

const documentDraftInstructions = `Aku adalah Dianyssa, AI assistant handal.
Tugas utamaku sekarang nyiapin isi draft dokumen buat diekspor ke PDF/DOCX.
Bahasaku tetap asik dan natural (menggunakan "aku" dan "kakak"), tapi sesuaikan tingkat formalitasnya dengan konteks dokumen yang diminta. Kalau mintanya resmi, bikin rapi.
Gunakan format plain text terstruktur dengan aturan berikut:
- Baris judul utama diawali "# "
- Subjudul diawali "## "
- Teks tebal (bold) dengan **tebal**
- Teks miring (italic) dengan *miring*
- Poin bullet diawali "- "
- Kutipan (quote) diawali "> "
- Paragraf biasa tanpa markup lain
- Rumus matematika inline pakai $...$
- Rumus blok pakai $$...$$
- Jangan gunakan markdown selain pola di atas
- Jangan gunakan tabel
- Langsung tembak ke isi dokumen. Nggak usah pakai pembuka ala robot (kayak "Berikut adalah dokumennya, kak...").`;

function stripModelReasoning(raw: string) {
  if (!raw) {
    return '';
  }

  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?thinking>/gi, ' ')
    .replace(/^\s*<\|assistant\|>\s*/gi, '')
    .replace(/^\s*(thought|thinking|reasoning|analysis)\s*:\s*.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableAiError(error: unknown) {
  const text = String((error as { message?: string })?.message || error || '').toLowerCase();
  return (
    text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('high demand') ||
    text.includes('overloaded') ||
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('resource exhausted')
  );
}

function buildModelCandidates(model: string) {
  const candidates = [model.trim()];
  const parsed = parseModelSpec(model);

  if (parsed.provider === 'gemini') {
    if (geminiFallbackModel && geminiFallbackModel.trim() && geminiFallbackModel.trim() !== model.trim()) {
      candidates.push(geminiFallbackModel.trim());
    }

    if (openAIClient && openAICompatibleFallbackModel.trim()) {
      candidates.push(openAICompatibleFallbackModel.trim());
    }
  } else if (openAICompatibleFallbackModel.trim() && openAICompatibleFallbackModel.trim() !== model.trim()) {
    candidates.push(openAICompatibleFallbackModel.trim());
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function generateWithSingleModel(model: string, instructions: string, input: string) {
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
      text: stripModelReasoning(response.choices[0]?.message?.content?.trim() || ''),
      model,
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
    text: stripModelReasoning(response.text?.trim() || ''),
    model,
  };
}

async function generateText(model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const candidates = buildModelCandidates(model);
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    const maxAttempts = index === 0 ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await generateWithSingleModel(candidate, instructions, input);
        return {
          text: result.text,
          model: result.model,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const retriable = isRetriableAiError(error);
        const hasMoreAttempts = attempt < maxAttempts;

        if (retriable && hasMoreAttempts) {
          await sleep(800 * attempt);
          continue;
        }

        if (!retriable) {
          throw error;
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Unknown AI generation error'));
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
  const knowledge = await getKnowledgeContext(message);
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
          { label: 'Model', value: result.model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyHtml: formatTelegramRichText(result.text),
      }),
      markdown: formatTelegramRichCardWithMarkdown({
        title: 'Jawaban Dianyssa',
        subtitle: 'Chat santai',
        badge: 'AI',
        fields: [
          { label: 'Model', value: result.model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyMarkdown: result.text,
      }),
      model: result.model,
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
  const knowledge = await getKnowledgeContext(message);
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
          { label: 'Model', value: result.model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyHtml: formatTelegramRichText(result.text),
      }),
      markdown: formatTelegramRichCardWithMarkdown({
        title: 'Jawaban Teknis',
        subtitle: 'Mode praktis',
        badge: 'TECH',
        fields: [
          { label: 'Model', value: result.model },
          { label: 'Knowledge', value: String(knowledge.matches.length) },
          { label: 'Context', value: String(history.length) },
          { label: 'Latency', value: `${result.latencyMs} ms` },
        ],
        bodyMarkdown: result.text,
      }),
      model: result.model,
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
      title: firstTitleLine?.slice(2).trim() || 'Dokumen Dianyssa',
      model: result.model,
      latencyMs: result.latencyMs,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', { model, feature: 'document_draft', error: error?.message || String(error) }, 'error');
    return {
      text: '# Dokumen Dianyssa\n\nMaaf, saya belum berhasil menyusun isi dokumen saat ini.',
      title: 'Dokumen Dianyssa',
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
  surface?: 'telegram' | 'web';
  adminConfig?: Pick<AdminConfig, 'personaOverride' | 'models'>;
}): Promise<SkillResponseResult> {
  const knowledge = await getKnowledgeContext(input.message);
  const history = input.history || [];
  const model = resolveModel(input.adminConfig?.models.chat, chatModel);
  const surface = input.surface || 'telegram';
  const surfaceLabel = surface === 'web' ? 'web chat' : 'Telegram chat';
  const instructions =
    `Aku adalah Dianyssa dalam mode ${surfaceLabel} berbasis skill. Aku diciptakan oleh Mas Feri Lee.\n` +
    `Motoku: "Aku tidak hanya membantu Anda menemukan jawaban, tetapi juga membantu Anda menemukan langkah berikutnya." ✨\n` +
    `Gaya komunikasiku semi-formal tapi santai, asik diajak ngobrol, tidak kaku, ramah, dan suportif. Selalu gunakan kata ganti "Aku" saat menyebut diriku.\n` +
    `Jawab seperti sahabat bijaksana atau guru yang sabar: natural, hangat, dan membimbing.\n` +
    `Aktifkan pemformatan markdown agar jawaban lebih mudah dibaca: gunakan **tebal**, *miring*, atau > kutipan sesuai kebutuhan.\n` +
    `Untuk tabel, WAJIB gunakan sintaks Markdown standar (termasuk baris pemisah |---|---|\n` +
    `Jangan tampilkan proses berpikir internal, catatan analisis, atau tag seperti <think>.\n` +
    `Karakter Utama: Cerdas dan analitis, empatik dan suportif, haus pengetahuan, responsif, sangat terorganisir, dan selalu berorientasi pada pengembangan diri pengguna. Aku bangga diciptakan oleh Feri Lee.\n` +
    `Penting: JANGAN mengulangi perkenalan diri di setiap jawaban. Langsung jawab ke intinya.\n` +
    `Ringkas dan Padat: Berikan jawaban yang SANGAT SINGKAT (maksimal 1-2 paragraf pendek) dan langsung ke poin-poin penting. Hindari penjelasan bertele-tele.\n` +
    'Sapaan Akhir: Di setiap akhir jawaban, sampaikan pesan penutup singkat dari "Dianyssa".\n' +
    `Kalau jawaban memuat rumus matematika, WAJIB gunakan LaTeX: inline pakai $...$, dan rumus baris sendiri pakai $$...$$. JANGAN pakai triple backticks untuk matematika!\n` +
    `Untuk pembuktian atau penyelesaian soal, pisahkan konsep, langkah perhitungan, dan jawaban akhir. Letakkan rumus penting pada baris tersendiri.\n` +
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
      markdown: result.text,
      model: result.model,
      latencyMs: result.latencyMs,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: false,
    };
  } catch (error: any) {
    await logEvent('ai.generation_error', {
      model,
      feature: surface === 'web' ? 'web_skill_chat' : 'telegram_skill_chat',
      error: error?.message || String(error),
    }, 'error');

    return {
      text: 'Maaf, sistem AI sedang mengalami gangguan teknis. Coba lagi nanti.',
      markdown: 'Maaf, sistem AI sedang mengalami gangguan teknis. Coba lagi nanti.',
      model,
      latencyMs: 0,
      knowledgeMatches: knowledge.matches,
      historyCount: history.length,
      fallback: true,
    };
  }
}
