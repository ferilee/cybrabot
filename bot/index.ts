import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { desc, eq } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { generateDocumentDraft, generateResponse, generateTechnicalResponse, getIntent, type ChatHistoryItem } from '../lib/ai';
import { getAdminConfig, saveAdminConfig } from '../lib/admin-config';
import { answerQuestionAboutDocument, explainDocumentFeatureError, summarizeDocumentFromPath } from '../lib/document-ai';
import { clearActiveDocumentSession, getActiveDocumentSession, saveActiveDocumentSession } from '../lib/document-session';
import { cleanupExportFile, detectDocumentExportRequest, materializeExportFile } from '../lib/document-export';
import { deleteKnowledgeDocument, saveKnowledgeDocument } from '../lib/knowledge';
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
const GROUP_ALLOWED_USER_ID = Number(process.env.GROUP_ALLOWED_USER_ID || 177517779);
const GROUP_ALLOWED_USERNAME = (process.env.GROUP_ALLOWED_USERNAME || 'ferilee').toLowerCase();

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

function isGroupChat(ctx: any) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

function isFromBotAccount(ctx: any) {
  return Boolean(ctx.from?.is_bot);
}

function isAuthorizedGroupUser(ctx: any) {
  if (!isGroupChat(ctx)) {
    return true;
  }

  const from = ctx.from;
  if (!from) {
    return false;
  }

  if (from.id !== GROUP_ALLOWED_USER_ID) {
    return false;
  }

  if (!GROUP_ALLOWED_USERNAME) {
    return true;
  }

  return String(from.username || '').toLowerCase() === GROUP_ALLOWED_USERNAME;
}

function isBotOwner(ctx: any) {
  const from = ctx.from;
  if (!from) {
    return false;
  }

  if (from.id !== GROUP_ALLOWED_USER_ID) {
    return false;
  }

  if (!GROUP_ALLOWED_USERNAME) {
    return true;
  }

  return String(from.username || '').toLowerCase() === GROUP_ALLOWED_USERNAME;
}

function getBotUsername(ctx: any) {
  const username = ctx.me?.username || ctx.botInfo?.username || '';
  return String(username).toLowerCase();
}

function isReplyToThisBot(ctx: any) {
  const replyFrom = ctx.message?.reply_to_message?.from;
  const botUsername = getBotUsername(ctx);
  if (!replyFrom?.is_bot) {
    return false;
  }
  if (!botUsername) {
    return true;
  }
  return String(replyFrom.username || '').toLowerCase() === botUsername;
}

function hasBotMention(text: string, ctx: any) {
  const lower = text.toLowerCase();
  const botUsername = getBotUsername(ctx);

  if (botUsername && lower.includes(`@${botUsername}`)) {
    return true;
  }

  return lower.includes('@cybraferibot') || lower.includes('cybraferibot');
}

function shouldHandleGroupText(ctx: any, text: string) {
  if (!isGroupChat(ctx)) {
    return true;
  }

  if (!isAuthorizedGroupUser(ctx)) {
    return false;
  }

  if (text.trim().startsWith('/')) {
    return true;
  }

  return isReplyToThisBot(ctx) || hasBotMention(text, ctx);
}

function shouldHandleGroupMedia(ctx: any, caption = '') {
  if (!isGroupChat(ctx)) {
    return true;
  }

  if (!isAuthorizedGroupUser(ctx)) {
    return false;
  }

  if (caption.trim().startsWith('/')) {
    return true;
  }

  return isReplyToThisBot(ctx) || hasBotMention(caption, ctx);
}

function normalizeIncomingText(text: string, ctx: any) {
  const botUsername = getBotUsername(ctx);
  let normalized = text;

  if (botUsername) {
    const mentionPattern = new RegExp(`@${botUsername}\\b`, 'ig');
    normalized = normalized.replace(mentionPattern, ' ');
  }

  normalized = normalized
    .replace(/@cybraferibot\b/ig, ' ')
    .replace(/\bcybraferibot\b[:,\- ]*/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || text.trim();
}

function shouldHandleGroupCommand(ctx: any) {
  if (!isGroupChat(ctx)) {
    return true;
  }

  return isAuthorizedGroupUser(ctx);
}

function shouldTreatAsDocumentQuestion(text: string, hasActiveSession: boolean) {
  const lower = text.toLowerCase();
  const docHints = [
    'dokumen',
    'pdf',
    'file ini',
    'berkas ini',
    'lampiran ini',
    'gambar ini',
    'teks ini',
    'isi file',
    'isi dokumen',
    'isi pdf',
    'baca',
    'ringkas',
    'rangkum',
    'meringkas',
    'jelaskan',
    'kesimpulan',
    'intisari',
    'poin penting',
    'apa isi',
    'apa kesimpulan',
    'bahas',
    'ulas',
  ];

  if (docHints.some((hint) => lower.includes(hint))) {
    return true;
  }

  if (!hasActiveSession) {
    return false;
  }

  const looksShortAndReferenced =
    lower.length <= 120 &&
    (lower.includes('?') || lower.startsWith('apa ') || lower.startsWith('tolong ') || lower.startsWith('bisa '));

  return looksShortAndReferenced && (lower.includes('ini') || lower.includes('itu') || lower.includes('file') || lower.includes('dokumen'));
}

async function requireOwner(ctx: any) {
  if (isBotOwner(ctx)) {
    return true;
  }

  await replySafely(ctx, 'Perintah admin ini hanya bisa dipakai oleh pemilik bot yang diizinkan.');
  return false;
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

async function processDocumentExport(ctx: any, requestText: string, startedAt: number) {
  const exportRequest = detectDocumentExportRequest(requestText);
  if (!exportRequest) {
    return false;
  }

  const userId = ctx.from.id;
  const history = await getConversationHistory(userId);
  const preferences = await getUserPreferences(userId);
  const adminConfig = await getAdminConfig();

  await replySafely(
    ctx,
    `Sedang menyiapkan file <b>${exportRequest.format.toUpperCase()}</b> untuk permintaan Kakak.`
  );

  let outputPath = '';
  try {
    const draft = await generateDocumentDraft(exportRequest.prompt, history, preferences, adminConfig);
    const exported = await materializeExportFile(draft.title || exportRequest.title, draft.text, exportRequest.format);
    outputPath = exported.outputPath;

    await ctx.replyWithDocument(exported.inputFile, {
      caption:
        `Berikut file <b>${exportRequest.format.toUpperCase()}</b> yang saya buat.\n` +
        `<b>Judul:</b> ${draft.title || exportRequest.title}`,
      parse_mode: 'HTML',
    });

    await db.insert(messages).values({
      userId,
      content: requestText,
      role: 'user',
      intent: `export_${exportRequest.format}`,
    });

    await db.insert(messages).values({
      userId,
      content: `[generated ${exportRequest.format}: ${draft.title || exportRequest.title}]`,
      role: 'bot',
      intent: `export_${exportRequest.format}`,
    });

    await logEvent('document.exported', {
      userId,
      format: exportRequest.format,
      title: draft.title || exportRequest.title,
      model: draft.model,
      latencyMs: draft.latencyMs,
      fallback: draft.fallback,
    });

    await logEvent('message.completed', {
      userId,
      route: `document_export_${exportRequest.format}`,
      durationMs: Date.now() - startedAt,
    });

    return true;
  } catch (error) {
    await logEvent('message.failed', {
      userId,
      chatId: ctx.chat.id,
      feature: 'document_export',
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await replySafely(
      ctx,
      'Maaf, saya belum berhasil membuat file yang diminta. Coba ulangi dengan permintaan yang lebih spesifik.'
    );
    return true;
  } finally {
    if (outputPath) {
      cleanupExportFile(outputPath);
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
    if (!shouldHandleGroupCommand(ctx)) {
      return;
    }

    const { first_name } = ctx.from!;
    await ensureUserRegistered(ctx.from!);

    await replySafely(ctx, `Halo <b>Kakak ${first_name}</b>! Saya @CybraFeriBot. Ada yang bisa saya bantu hari ini? 🚀`);
  } catch (error) {
    console.error('Error in /start command:', error);
    await ctx.reply('Terjadi kesalahan saat memulai bot. Silakan coba lagi nanti.');
  }
});

bot.command('dokumen', async (ctx) => {
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

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
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  await clearActiveDocumentSession(ctx.from!.id);
  await replySafely(ctx, 'Dokumen aktif sudah saya hapus. Kirim PDF atau gambar baru kalau ingin mulai sesi dokumen lagi.');
});

bot.command('admin_status', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const config = await getAdminConfig();
  await replySafely(
    ctx,
    `<b>Status Admin CybraFeriBot</b>\n\n` +
    `<b>Tools:</b>\n` +
    `- math: ${config.enabledTools.math ? 'on' : 'off'}\n` +
    `- caption: ${config.enabledTools.caption ? 'on' : 'off'}\n` +
    `- announcement: ${config.enabledTools.announcement ? 'on' : 'off'}\n` +
    `- faq: ${config.enabledTools.faq ? 'on' : 'off'}\n\n` +
    `<b>Persona override:</b> ${config.personaOverride ? 'active' : 'empty'}\n` +
    `<b>Self templates:</b> ready`
  );
});

bot.command('admin_tool', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_tool(@\w+)?/i, '').trim();
  const [toolNameRaw, stateRaw] = raw.split(/\s+/);
  const toolName = toolNameRaw?.toLowerCase();
  const state = stateRaw?.toLowerCase();

  if (!toolName || !state || !['math', 'caption', 'announcement', 'faq'].includes(toolName) || !['on', 'off'].includes(state)) {
    await replySafely(ctx, 'Format: <b>/admin_tool [math|caption|announcement|faq] [on|off]</b>');
    return;
  }

  const updated = await saveAdminConfig({
    enabledTools: {
      [toolName]: state === 'on',
    } as any,
  });

  await replySafely(ctx, `Tool <b>${toolName}</b> sekarang <b>${updated.enabledTools[toolName as keyof typeof updated.enabledTools] ? 'on' : 'off'}</b>.`);
});

bot.command('admin_persona', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_persona(@\w+)?/i, '').trim();
  await saveAdminConfig({
    personaOverride: raw,
  });

  await replySafely(ctx, raw ? 'Persona override berhasil diperbarui.' : 'Persona override dikosongkan.');
});

bot.command('admin_self', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_self(@\w+)?/i, '').trim();
  const [fieldLine, ...contentLines] = raw.split('\n');
  const field = fieldLine?.trim().toLowerCase();
  const content = contentLines.join('\n').trim();

  if (!field || !['identity', 'features', 'workflow', 'improvement'].includes(field)) {
    await replySafely(
      ctx,
      `Format:\n<b>/admin_self identity</b>\nisi baru\n\n` +
      `Field valid: <b>identity</b>, <b>features</b>, <b>workflow</b>, <b>improvement</b>`
    );
    return;
  }

  if (!content) {
    await replySafely(ctx, 'Isi template baru tidak boleh kosong.');
    return;
  }

  await saveAdminConfig({
    selfDescribe: {
      [field]: content,
    } as any,
  });

  await replySafely(ctx, `Template <b>${field}</b> berhasil diperbarui.`);
});

bot.command('admin_knowledge_add', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_knowledge_add(@\w+)?/i, '').trim();
  const [idLine, titleLine, ...contentLines] = raw.split('\n');
  const id = idLine?.trim();
  const title = titleLine?.trim();
  const content = contentLines.join('\n').trim();

  if (!id || !title || !content) {
    await replySafely(
      ctx,
      `Format:\n<b>/admin_knowledge_add id-dokumen</b>\nJudul dokumen\nIsi dokumen`
    );
    return;
  }

  const item = saveKnowledgeDocument({ id, title, content });
  await replySafely(ctx, `Knowledge <b>${item.id}</b> berhasil disimpan.`);
});

bot.command('admin_knowledge_delete', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_knowledge_delete(@\w+)?/i, '').trim();
  if (!raw) {
    await replySafely(ctx, 'Format: <b>/admin_knowledge_delete id-dokumen</b>');
    return;
  }

  deleteKnowledgeDocument(raw);
  await replySafely(ctx, `Knowledge <b>${raw}</b> dihapus.`);
});

bot.on('message:document', async (ctx) => {
  if (isFromBotAccount(ctx)) {
    return;
  }

  const caption = ctx.message.caption || '';
  if (!shouldHandleGroupMedia(ctx, caption)) {
    return;
  }

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
  if (isFromBotAccount(ctx)) {
    return;
  }

  const caption = ctx.message.caption || '';
  if (!shouldHandleGroupMedia(ctx, caption)) {
    return;
  }

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
    if (isFromBotAccount(ctx)) {
      return;
    }

    const rawText = ctx.message.text;
    if (!shouldHandleGroupText(ctx, rawText)) {
      return;
    }

    const text = normalizeIncomingText(rawText, ctx);
    const userId = ctx.from.id;
    await ensureUserRegistered(ctx.from);

    if (await processDocumentExport(ctx, text, startedAt)) {
      return;
    }

    await logEvent('message.received', {
      userId,
      chatId: ctx.chat.id,
      messageLength: rawText.length,
      normalizedLength: text.length,
      chatType: ctx.chat?.type,
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
      content: rawText,
      role: 'user',
      intent: intentResult.intent,
    });

    const history = await getConversationHistory(userId);
    const lowerText = text.toLowerCase();
    const activeDocument = await getActiveDocumentSession(userId);
    if (lowerText.startsWith('dokumen:')) {
      const question = text.slice(text.indexOf(':') + 1).trim();
      if (!question) {
        await replySafely(ctx, 'Tulis pertanyaannya setelah <b>dokumen:</b>. Contoh: <b>dokumen: apa kesimpulan utama file ini?</b>');
        return;
      }

      await answerActiveDocumentQuestion(ctx, question, startedAt);
      return;
    }

    if (activeDocument && shouldTreatAsDocumentQuestion(text, true)) {
      await answerActiveDocumentQuestion(ctx, text, startedAt);
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
        route: toolResult.toolName === 'self_describe' ? 'self_describe' : 'tool',
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
