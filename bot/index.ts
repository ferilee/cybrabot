import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { desc, eq } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { generateResponse, generateTechnicalResponse, getIntent, type ChatHistoryItem } from '../lib/ai';
import { getAdminConfig } from '../lib/admin-config';
import { answerQuestionAboutDocument, explainDocumentFeatureError, summarizeDocumentFromPath } from '../lib/document-ai';
import { clearActiveDocumentSession, getActiveDocumentSession, saveActiveDocumentSession } from '../lib/document-session';
import { logEvent } from '../lib/observability';
import { detectPreferenceUpdate, formatPreferenceConfirmation, getUserPreferences, saveUserPreferences } from '../lib/preferences';
import { runLocalTool } from '../lib/tools';

const token = process.env.TELEGRAM_BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
if (token.startsWith('123456')) {
  console.warn("⚠️ Using default placeholder token! Check your .env file.");
} else {
  console.log("✅ Telegram token loaded successfully.");
}
export const bot = new Bot(token);

const TELEGRAM_MESSAGE_LIMIT = 4000;
const DOCUMENT_DOWNLOAD_DIR = '/tmp/cybrabot-documents';
const MAX_DOCUMENT_BYTES = Number(process.env.DOCUMENT_MAX_BYTES || 20 * 1024 * 1024);

mkdirSync(DOCUMENT_DOWNLOAD_DIR, { recursive: true });

function limitTelegramMessage(text: string) {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }

  return `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 3)}...`;
}

async function replySafely(ctx: any, text: string) {
  const limitedText = limitTelegramMessage(text);

  try {
    await ctx.reply(limitedText, { parse_mode: 'HTML' });
  } catch (error: any) {
    const description = error?.description || error?.message || '';
    const isParseError =
      description.includes("can't parse entities") ||
      description.includes('message is too long') ||
      description.includes('Bad Request');

    if (!isParseError) {
      throw error;
    }

    await ctx.reply(limitTelegramMessage(limitedText.replace(/<[^>]+>/g, '')));
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function inferMimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

async function ensureUserRegistered(user: { id: number; username?: string; first_name?: string }) {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (!existingUser) {
    await db.insert(users).values({
      id: user.id,
      username: user.username,
      firstName: user.first_name,
    });
  }
}

async function downloadTelegramFile(fileId: string, fileName: string, mimeType: string) {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error('Telegram file path is missing');
  }

  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }

  const bytes = await response.bytes();
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`Ukuran file melebihi batas ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}MB`);
  }

  const extension = extensionFromMimeType(mimeType);
  const outputPath = join(
    DOCUMENT_DOWNLOAD_DIR,
    `${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(fileName || `document.${extension}`)}`
  );
  await Bun.write(outputPath, bytes);

  return {
    localPath: outputPath,
    telegramFilePath: file.file_path,
  };
}

async function answerActiveDocumentQuestion(ctx: any, question: string, startedAt = Date.now()) {
  const userId = ctx.from.id;
  const session = await getActiveDocumentSession(userId);

  if (!session) {
    await replySafely(
      ctx,
      'Belum ada dokumen aktif. Kirim PDF atau gambar dulu, nanti saya ringkas dan saya pakai untuk tanya jawab.'
    );
    return true;
  }

  const answer = await answerQuestionAboutDocument(session, question);
  await logEvent('document.question_answered', {
    userId,
    title: session.title,
    model: answer.model,
    latencyMs: answer.latencyMs,
  });
  await replySafely(ctx, answer.text);

  await db.insert(messages).values({
    userId,
    content: `Pertanyaan dokumen: ${question}`,
    role: 'user',
    intent: 'document_question',
  });

  await db.insert(messages).values({
    userId,
    content: answer.text,
    role: 'bot',
    intent: 'document_answer',
  });

  await logEvent('message.completed', {
    userId,
    route: 'document_qa',
    durationMs: Date.now() - startedAt,
  });

  return true;
}

async function processIncomingDocument(ctx: any, input: {
  fileId: string;
  fileName: string;
  mimeType: string;
  userFacingType: 'pdf' | 'image';
}) {
  const startedAt = Date.now();
  const userId = ctx.from.id;
  await ensureUserRegistered(ctx.from);

  await logEvent('document.received', {
    userId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    type: input.userFacingType,
  });

  await db.insert(messages).values({
    userId,
    content: `[uploaded ${input.userFacingType}: ${input.fileName}]`,
    role: 'user',
    intent: 'document_upload',
  });

  await replySafely(ctx, `Sedang memproses <b>${input.fileName}</b>. Saya akan buat ringkasan lalu menyimpannya sebagai dokumen aktif.`);

  let localPath = '';
  try {
    const downloaded = await downloadTelegramFile(input.fileId, input.fileName, input.mimeType);
    localPath = downloaded.localPath;

    const summary = await summarizeDocumentFromPath(localPath, input.mimeType, input.fileName);
    await saveActiveDocumentSession({
      userId,
      title: input.fileName,
      mimeType: input.mimeType,
      telegramFileId: input.fileId,
      telegramFilePath: downloaded.telegramFilePath,
      geminiFileName: summary.geminiFileName,
      geminiFileUri: summary.geminiFileUri,
      summary: summary.summary,
    });

    await logEvent('document.summarized', {
      userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      model: summary.model,
      latencyMs: summary.latencyMs,
    });

    const reply =
      `${summary.summary}\n\n` +
      `<b>Dokumen aktif:</b> ${input.fileName}\n` +
      `Untuk bertanya tentang dokumen ini, kirim <b>dokumen: pertanyaan Anda</b> atau <b>/dokumen pertanyaan Anda</b>.`;

    await replySafely(ctx, reply);
    await db.insert(messages).values({
      userId,
      content: reply,
      role: 'bot',
      intent: 'document_summary',
    });

    await logEvent('message.completed', {
      userId,
      route: 'document_summary',
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await explainDocumentFeatureError(error, {
      userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });
    await replySafely(
      ctx,
      'Maaf, file itu belum berhasil saya proses. Saat ini saya hanya mendukung <b>PDF</b> dan <b>gambar</b> yang ukurannya masih wajar.'
    );
  } finally {
    if (localPath) {
      rmSync(localPath, { force: true });
    }
  }
}

async function getConversationHistory(userId: number): Promise<ChatHistoryItem[]> {
  const recentMessages = await db.query.messages.findMany({
    where: eq(messages.userId, userId),
    orderBy: [desc(messages.timestamp), desc(messages.id)],
    limit: 10,
  });

  return recentMessages
    .slice()
    .reverse()
    .map((message) => ({
      role: (message.role === 'bot' ? 'bot' : 'user') as ChatHistoryItem['role'],
      content: message.content ?? '',
    }))
    .filter((message) => message.content.trim().length > 0);
}

bot.command('start', async (ctx) => {
  try {
    const { first_name } = ctx.from!;
    await ensureUserRegistered(ctx.from!);

    await replySafely(ctx, `Halo <b>Kakak ${first_name}</b>! Saya @CybraFeriBot. Ada yang bisa saya bantu hari ini? 🚀`);
  } catch (error) {
    console.error('Error in /start command:', error);
    await ctx.reply('Terjadi kesalahan saat memulai bot. Silakan coba lagi nanti.');
  }
});

bot.command('dokumen', async (ctx) => {
  const startedAt = Date.now();
  const raw = ctx.message!.text.replace(/^\/dokumen(@\w+)?/i, '').trim();
  if (!raw) {
    const session = await getActiveDocumentSession(ctx.from!.id);
    if (!session) {
      await replySafely(
        ctx,
        'Belum ada dokumen aktif. Kirim PDF atau gambar dulu, lalu gunakan <b>/dokumen pertanyaan Anda</b>.'
      );
      return;
    }

    await replySafely(
      ctx,
      `<b>Dokumen aktif:</b> ${session.title}\n` +
      `${session.summary ? `\n<b>Ringkasan singkat:</b>\n${session.summary}` : ''}\n\n` +
      `Lanjutkan dengan format <b>/dokumen pertanyaan Anda</b>.`
    );
    return;
  }

  await answerActiveDocumentQuestion(ctx, raw, startedAt);
});

bot.command('dokumen_reset', async (ctx) => {
  await clearActiveDocumentSession(ctx.from!.id);
  await replySafely(ctx, 'Dokumen aktif sudah saya hapus. Kirim PDF atau gambar baru kalau ingin mulai sesi dokumen lagi.');
});

bot.on('message:document', async (ctx) => {
  const document = ctx.message.document;
  const mimeType =
    (!document.mime_type || document.mime_type === 'application/octet-stream')
      ? inferMimeTypeFromName(document.file_name || '')
      : document.mime_type;
  const fileName = document.file_name || `document-${document.file_unique_id}`;
  const fileSize = document.file_size || 0;

  if (!mimeType || (mimeType !== 'application/pdf' && !mimeType.startsWith('image/'))) {
    await replySafely(ctx, 'Saat ini saya hanya mendukung file <b>PDF</b> atau <b>gambar</b>.');
    return;
  }
  if (fileSize > MAX_DOCUMENT_BYTES) {
    await replySafely(ctx, `Ukuran file terlalu besar. Batas saat ini sekitar <b>${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}MB</b>.`);
    return;
  }

  await processIncomingDocument(ctx, {
    fileId: document.file_id,
    fileName,
    mimeType,
    userFacingType: mimeType === 'application/pdf' ? 'pdf' : 'image',
  });
});

bot.on('message:photo', async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  if (!photo) {
    return;
  }

  await processIncomingDocument(ctx, {
    fileId: photo.file_id,
    fileName: `photo-${photo.file_unique_id}.jpg`,
    mimeType: 'image/jpeg',
    userFacingType: 'image',
  });
});

bot.on('message:text', async (ctx) => {
  const startedAt = Date.now();
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    await ensureUserRegistered(ctx.from);

    await logEvent('message.received', {
      userId,
      chatId: ctx.chat.id,
      messageLength: text.length,
    });

    // 1. NLP Analysis
    const analysis = analyzeText(text);
    
    // 2. AI Intent Routing
    const intentResult = await getIntent(text);
    await logEvent('message.intent_classified', {
      userId,
      intent: intentResult.intent,
      model: intentResult.model,
      latencyMs: intentResult.latencyMs,
      fallback: intentResult.fallback,
      hasNumbers: analysis.hasNumbers,
      isQuestion: analysis.isQuestion,
      wordCount: analysis.wordCount,
    });

    // 3. Save User Message
    await db.insert(messages).values({
      userId,
      content: text,
      role: 'user',
      intent: intentResult.intent,
    });

    const history = await getConversationHistory(userId);
    const lowerText = text.toLowerCase();
    if (lowerText.startsWith('dokumen:')) {
      const question = text.slice(text.indexOf(':') + 1).trim();
      if (!question) {
        await replySafely(ctx, 'Tulis pertanyaannya setelah <b>dokumen:</b>. Contoh: <b>dokumen: apa kesimpulan utama file ini?</b>');
        return;
      }

      await answerActiveDocumentQuestion(ctx, question, startedAt);
      return;
    }

    const preferenceUpdate = detectPreferenceUpdate(text);
    if (preferenceUpdate) {
      const savedPreferences = await saveUserPreferences(userId, preferenceUpdate);
      const confirmation = formatPreferenceConfirmation(savedPreferences);
      await logEvent('message.preference_updated', {
        userId,
        preferences: savedPreferences,
      });
      await replySafely(ctx, confirmation);

      await db.insert(messages).values({
        userId,
        content: confirmation,
        role: 'bot',
        intent: 'preference',
      });

      return;
    }

    const preferences = await getUserPreferences(userId);
    const adminConfig = await getAdminConfig();
    const toolResult = runLocalTool(text, adminConfig);

    if (toolResult.handled && toolResult.response) {
      await logEvent('message.tool_used', {
        userId,
        toolName: toolResult.toolName,
        metadata: toolResult.metadata || {},
      });
      await replySafely(ctx, toolResult.response);

      await db.insert(messages).values({
        userId,
        content: toolResult.response,
        role: 'bot',
        intent: toolResult.toolName || intentResult.intent,
      });

      await logEvent('message.completed', {
        userId,
        route: 'tool',
        durationMs: Date.now() - startedAt,
      });

      return;
    }

    if (intentResult.intent === 'technical') {
      const response = await generateTechnicalResponse(text, history, preferences, adminConfig);
      await logEvent('message.ai_used', {
        userId,
        route: 'technical',
        model: response.model,
        latencyMs: response.latencyMs,
        historyCount: response.historyCount,
        knowledgeMatches: response.knowledgeMatches,
        fallback: response.fallback,
      });
      await replySafely(ctx, response.text);

      await db.insert(messages).values({
        userId,
        content: response.text,
        role: 'bot',
        intent: 'technical',
      });

      await logEvent('message.completed', {
        userId,
        route: 'technical_ai',
        durationMs: Date.now() - startedAt,
      });
    } else {
      // 4. Local Keyword Handling (to save AI quota)
      if (lowerText.includes('feri lee') || lowerText.includes('mas feri') || lowerText.includes('/about')) {
        const feriInfo = `
<b>Mas Feri Dwi Hermawan (atau Mas Feri Lee)</b> ini bisa dibilang sosok "Guru SMK Paket Lengkap".

Di satu sisi, Mas Feri adalah abdi negara yang mengajar Matematika di <b>SMKN Pasirian, Lumajang</b>, bahkan dipercaya jadi Ketua MGMP Matematika SMK se-Kabupaten Lumajang. Tapi di sisi lain, beliau adalah tech enthusiast yang "ngoprek"-nya sudah level tinggi.

<b>Beberapa hal unik tentang beliau:</b>
• <b>Guru Melek Teknologi:</b> Ngebangun ekosistem digital lewat proyek Guru Melek AI & Akademi Inovasi Guru (IDT).
• <b>Skill Developer:</b> Fasih coding (Bun, Hono, React) dan edit video sinematik.
• <b>Sangat Rapi:</b> Ahli bikin sistem otomatis sekolah & website silsilah keluarga.
• <b>Sisi Personal:</b> Penikmat kopi hitam & sangat menghargai sejarah keluarga.

Singkatnya, beliau adalah pendidik modern yang selalu haus belajar hal baru! 🚀☕️`;
        await replySafely(ctx, feriInfo);
        
        // Save Response to DB
        await db.insert(messages).values({
          userId,
          content: feriInfo,
          role: 'bot',
          intent: 'casual',
        });

        await logEvent('message.completed', {
          userId,
          route: 'local_about',
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // 5. Casual Chat with LLM
      const response = await generateResponse(text, history, preferences, adminConfig);
      await logEvent('message.ai_used', {
        userId,
        route: 'casual',
        model: response.model,
        latencyMs: response.latencyMs,
        historyCount: response.historyCount,
        knowledgeMatches: response.knowledgeMatches,
        fallback: response.fallback,
      });
      await replySafely(ctx, response.text);
      
      // Save Bot Response
      await db.insert(messages).values({
        userId,
        content: response.text,
        role: 'bot',
        intent: 'casual',
      });

      await logEvent('message.completed', {
        userId,
        route: 'casual_ai',
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (error) {
    await logEvent('message.failed', {
      userId: ctx?.from?.id,
      chatId: ctx?.chat?.id,
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await ctx.reply('Aduh, sepertinya otak digital saya sedikit korsleting. Bisa ulangi pertanyaannya? 🤖');
  }
});

export const handleUpdate = (c: any) => webhookCallback(bot, 'hono')(c);
