import 'dotenv/config';
import { Bot, InputFile, webhookCallback } from 'grammy';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { db } from '../db';
import { users, messages, groupMembers } from '../db/schema';
import { desc, eq, and } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { generateDocumentDraft, getIntent, type ChatHistoryItem } from '../lib/ai';
import { getAdminConfig, isOpenAICompatibleConfigured, saveAdminConfig } from '../lib/admin-config';
import { answerQuestionAboutDocument, explainDocumentFeatureError, summarizeDocumentFromPath } from '../lib/document-ai';
import { clearActiveDocumentSession, getActiveDocumentSession, saveActiveDocumentSession } from '../lib/document-session';
import { cleanupExportFile, detectDocumentExportRequest, getExportProcessingMessage, materializeExportFile } from '../lib/document-export';
import { deleteKnowledgeDocument, saveKnowledgeDocument } from '../lib/knowledge';
import { saveWebSkill, deleteWebSkill } from '../lib/web-skills';
import { getProviderQuotaStatus } from '../lib/provider-status';
import { logEvent } from '../lib/observability';
import { detectPreferenceUpdate, formatPreferenceConfirmation, getUserPreferences, saveUserPreferences } from '../lib/preferences';
import { getRuntimeResponse } from '../lib/runtime-responses';
import { runSkillChat } from '../lib/skill-chat';
import { runLocalTool } from '../lib/tools';
import { runAgentLoop } from '../lib/agent';
import { escapeHtml, formatTelegramRichCard, formatTelegramRichCardWithBody, formatTelegramRichText, getTelegramDraftStatusHtml, renderTelegramHtmlFallback, renderTelegramMessageContent, simplifyTelegramRichContent, fixBadMarkdown, formatInlineTelegramRichText } from '../lib/telegram-rich';

const token = process.env.TELEGRAM_BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
if (token.startsWith('123456')) {
  console.warn("⚠️ Using default placeholder token! Check your .env file.");
} else {
  console.log("✅ Telegram token loaded successfully.");
}
export const bot = new Bot(token);

const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_RICH_MESSAGE_LIMIT = 30000;
const DOCUMENT_DOWNLOAD_DIR = '/tmp/cybrabot-documents';
const MAX_DOCUMENT_BYTES = Number(process.env.DOCUMENT_MAX_BYTES || 20 * 1024 * 1024);
const GROUP_ALLOWED_USER_ID = Number(process.env.GROUP_ALLOWED_USER_ID || 177517779);
const GROUP_ALLOWED_USERNAME = (process.env.GROUP_ALLOWED_USERNAME || 'ferilee').toLowerCase();
const PROCESSED_UPDATE_TTL_MS = 10 * 60 * 1000;
const processedUpdateIds = new Map<number, number>();
const CHAT_ACTION_INTERVAL_MS = 3500;
const RICH_DRAFT_REFRESH_INTERVAL_MS = 9000;
const PROCESSING_INDICATOR_MAX_MS = Number(process.env.TELEGRAM_PROCESSING_INDICATOR_MAX_MS || 120000);

type ProcessingIndicatorMode = 'text' | 'document' | 'photo' | 'export';
type TelegramChatAction =
  | 'typing'
  | 'upload_photo'
  | 'upload_document';
const INDICATOR_STOP_KEY = '__cybraProcessingIndicatorStop';

mkdirSync(DOCUMENT_DOWNLOAD_DIR, { recursive: true });

function getProcessingIndicatorSequence(mode: ProcessingIndicatorMode): TelegramChatAction[] {
  switch (mode) {
    case 'document':
      return ['typing', 'upload_document', 'typing'];
    case 'photo':
      return ['typing', 'upload_photo', 'typing'];
    case 'export':
      return ['typing', 'upload_document'];
    case 'text':
    default:
      return ['typing'];
  }
}

function startProcessingIndicator(ctx: any, mode: ProcessingIndicatorMode) {
  if (typeof ctx?.[INDICATOR_STOP_KEY] === 'function') {
    return () => {};
  }

  const sequence = getProcessingIndicatorSequence(mode);
  let index = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let richDraftDisabled = false;
  const richDraftId = resolveRichDraftId(ctx);
  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    if (draftTimer) {
      clearTimeout(draftTimer);
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
    }
    if (ctx?.[INDICATOR_STOP_KEY] === stop) {
      delete ctx[INDICATOR_STOP_KEY];
    }
  };

  const tick = async () => {
    if (stopped || !ctx?.chat?.id) {
      return;
    }

    try {
      const action = sequence[index % sequence.length] || 'typing';
      index += 1;
      await ctx.api.sendChatAction(ctx.chat.id, action);
    } catch {
      // Ignore indicator failures. The reply path remains the source of truth.
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, CHAT_ACTION_INTERVAL_MS);
      }
    }
  };

  const streamDraft = async () => {
    if (stopped || richDraftDisabled || !richDraftId) {
      return;
    }

    try {
      await ctx.api.raw.sendRichMessageDraft({
        chat_id: ctx.chat.id,
        message_thread_id: typeof ctx.message?.message_thread_id === 'number' ? ctx.message.message_thread_id : undefined,
        draft_id: richDraftId,
        rich_message: {
          html: getTelegramDraftStatusHtml(mode),
        },
      } as any);
    } catch (error) {
      richDraftDisabled = true;
      await logEvent('telegram.rich_draft_failed', {
        chatId: ctx?.chat?.id ?? null,
        messageId: ctx?.message?.message_id ?? null,
        error: stringifyTelegramError(error),
      }, 'warn');
      return;
    }

    if (!stopped && !richDraftDisabled) {
      draftTimer = setTimeout(() => {
        void streamDraft();
      }, RICH_DRAFT_REFRESH_INTERVAL_MS);
    }
  };

  void tick();
  void streamDraft();

  if (Number.isFinite(PROCESSING_INDICATOR_MAX_MS) && PROCESSING_INDICATOR_MAX_MS > 0) {
    maxTimer = setTimeout(() => {
      if (stopped) {
        return;
      }

      void logEvent('telegram.processing_indicator_timeout', {
        chatId: ctx?.chat?.id ?? null,
        messageId: ctx?.message?.message_id ?? null,
        mode,
        maxDurationMs: PROCESSING_INDICATOR_MAX_MS,
      }, 'warn');
      stop();
    }, PROCESSING_INDICATOR_MAX_MS);
  }

  ctx[INDICATOR_STOP_KEY] = stop;
  return stop;
}

function pruneProcessedUpdates(now = Date.now()) {
  for (const [updateId, seenAt] of processedUpdateIds) {
    if (now - seenAt > PROCESSED_UPDATE_TTL_MS) {
      processedUpdateIds.delete(updateId);
    }
  }
}

function shouldSkipDuplicateUpdate(ctx: any) {
  const updateId = ctx.update?.update_id;
  if (typeof updateId !== 'number') {
    return false;
  }

  const now = Date.now();
  pruneProcessedUpdates(now);

  if (processedUpdateIds.has(updateId)) {
    return true;
  }

  processedUpdateIds.set(updateId, now);
  return false;
}

async function trackGroupMember(chatId: number, user: { id: number; username?: string; first_name?: string }) {
  const existing = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.chatId, chatId), eq(groupMembers.userId, user.id)),
  });

  if (existing) {
    await db.update(groupMembers).set({
      username: user.username,
      firstName: user.first_name,
      lastSeenAt: new Date(),
    }).where(eq(groupMembers.id, existing.id));
  } else {
    await db.insert(groupMembers).values({
      chatId,
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
    });
  }
}

bot.use(async (ctx, next) => {
  if (shouldSkipDuplicateUpdate(ctx)) {
    await logEvent('telegram.update_deduplicated', {
      updateId: ctx.update?.update_id ?? null,
      chatId: ctx.chat?.id ?? null,
      messageId: ctx.message?.message_id ?? null,
    });
    return;
  }

  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') && ctx.from && !ctx.from.is_bot) {
    await trackGroupMember(ctx.chat.id, ctx.from).catch(() => {});
  }

  await next();
});

function limitTelegramMessage(text: string) {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }

  const truncated = `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 20)}...`;
  if (text.startsWith('<blockquote expandable>')) {
    return `${truncated}</blockquote>`;
  }
  return truncated;
}

function limitRichTelegramMessage(text: string) {
  if (text.length <= TELEGRAM_RICH_MESSAGE_LIMIT) {
    return text;
  }

  const truncated = `${text.slice(0, TELEGRAM_RICH_MESSAGE_LIMIT - 20)}...`;
  if (text.startsWith('<blockquote expandable>')) {
    return `${truncated}</blockquote>`;
  }
  return truncated;
}

function buildReplyParameters(ctx: any) {
  const messageId = ctx.message?.message_id;
  if (!messageId) {
    return undefined;
  }

  return { message_id: messageId };
}

function isPrivateChat(ctx: any) {
  return ctx?.chat?.type === 'private';
}

function resolveRichDraftId(ctx: any) {
  const fromMessage = Number(ctx?.message?.message_id || 0);
  if (Number.isInteger(fromMessage) && fromMessage > 0) {
    return fromMessage;
  }

  const fromUpdate = Number(ctx?.update?.update_id || 0);
  if (Number.isInteger(fromUpdate) && fromUpdate > 0) {
    return fromUpdate;
  }

  const fallback = Date.now() % 2147483647;
  return fallback > 0 ? fallback : 1;
}

async function sendRichTelegramMessage(ctx: any, text: string) {
  const payload: Record<string, unknown> = {
    chat_id: ctx.chat.id,
    rich_message: {
      html: limitRichTelegramMessage(text),
    },
  };

  const replyParameters = buildReplyParameters(ctx);
  if (replyParameters) {
    payload.reply_parameters = replyParameters;
  }

  return ctx.api.raw.sendRichMessage(payload as any);
}

async function sendRichTelegramMarkdown(ctx: any, text: string) {
  const payload: Record<string, unknown> = {
    chat_id: ctx.chat.id,
    rich_message: {
      markdown: limitRichTelegramMessage(text),
    },
  };

  const replyParameters = buildReplyParameters(ctx);
  if (replyParameters) {
    payload.reply_parameters = replyParameters;
  }

  return ctx.api.raw.sendRichMessage(payload as any);
}

function shouldFallbackFromRichMessage(error: any) {
  const description = error?.description || error?.message || '';
  return (
    description.includes("can't parse entities") ||
    description.includes('sendRichMessage') ||
    description.includes('message is too long') ||
    description.includes('Bad Request')
  );
}

function stringifyTelegramError(error: any) {
  return error?.description || error?.message || String(error);
}

async function replySafely(ctx: any, text: string) {
  const renderedText = renderTelegramMessageContent(text);
  const limitedText = limitRichTelegramMessage(renderedText);

  try {
    await sendRichTelegramMessage(ctx, limitedText);
  } catch (error: any) {
    await logEvent('telegram.rich_message_primary_failed', {
      chatId: ctx?.chat?.id ?? null,
      messageId: ctx?.message?.message_id ?? null,
      error: stringifyTelegramError(error),
    }, 'warn');

    if (!shouldFallbackFromRichMessage(error)) {
      throw error;
    }

    const simplifiedText = limitRichTelegramMessage(simplifyTelegramRichContent(limitedText));
    if (simplifiedText && simplifiedText !== limitedText) {
      try {
        await sendRichTelegramMessage(ctx, simplifiedText);
        return;
      } catch (secondaryError: any) {
        await logEvent('telegram.rich_message_secondary_failed', {
          chatId: ctx?.chat?.id ?? null,
          messageId: ctx?.message?.message_id ?? null,
          error: stringifyTelegramError(secondaryError),
        }, 'warn');

        if (!shouldFallbackFromRichMessage(secondaryError)) {
          throw secondaryError;
        }
      }
    }

    const htmlFallback = limitTelegramMessage(renderTelegramHtmlFallback(simplifiedText));
    try {
      await ctx.reply(htmlFallback, { parse_mode: 'HTML' });
    } catch (plainError: any) {
      await logEvent('telegram.plain_reply_html_failed', {
        chatId: ctx?.chat?.id ?? null,
        messageId: ctx?.message?.message_id ?? null,
        error: stringifyTelegramError(plainError),
      }, 'warn');
      const plainText = limitTelegramMessage(htmlFallback.replace(/<[^>]+>/g, ''));
      await ctx.reply(plainText);
    }
  }
}

async function replySafelyMarkdown(ctx: any, markdownText: string) {
  const fixedMarkdown = fixBadMarkdown(markdownText);
  const limitedText = limitRichTelegramMessage(fixedMarkdown);
  try {
    await sendRichTelegramMarkdown(ctx, limitedText);
  } catch (error: any) {
    await logEvent('telegram.rich_message_markdown_failed', {
      chatId: ctx?.chat?.id ?? null,
      messageId: ctx?.message?.message_id ?? null,
      error: stringifyTelegramError(error),
    }, 'warn');
    
    // Fallback to sending it as plain HTML since the markdown renderer failed
    await replySafely(ctx, markdownText);
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

  if (GROUP_ALLOWED_USERNAME && String(from.username || '').toLowerCase() === GROUP_ALLOWED_USERNAME) {
    return true;
  }

  if (GROUP_ALLOWED_USER_ID && from.id === GROUP_ALLOWED_USER_ID) {
    return true;
  }

  return false;
}

function isBotOwner(ctx: any) {
  const from = ctx.from;
  if (!from) {
    return false;
  }

  if (GROUP_ALLOWED_USERNAME && String(from.username || '').toLowerCase() === GROUP_ALLOWED_USERNAME) {
    return true;
  }

  if (GROUP_ALLOWED_USER_ID && from.id === GROUP_ALLOWED_USER_ID) {
    return true;
  }

  return false;
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

  if (botUsername && (lower.includes(`@${botUsername}`) || lower.includes(botUsername))) {
    return true;
  }

  return lower.includes('@cybraferibot') || lower.includes('cybraferibot') || lower.includes('dianyssa');
}

function shouldHandleGroupText(ctx: any, text: string) {
  if (!isGroupChat(ctx)) {
    return true;
  }

  if (!isAuthorizedGroupUser(ctx)) {
    return false;
  }

  if (ctx.message?.reply_to_message?.from?.id === ctx.me?.id) {
    return true;
  }

  if (hasBotMention(text, ctx)) {
    return true;
  }

  return false;
}

function shouldHandleGroupMedia(ctx: any, caption = '') {
  if (!isGroupChat(ctx)) {
    return true;
  }

  if (!isAuthorizedGroupUser(ctx)) {
    return false;
  }

  if (ctx.message?.reply_to_message?.from?.id === ctx.me?.id) {
    return true;
  }

  if (hasBotMention(caption, ctx)) {
    return true;
  }

  return false;
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
    'docx',
    'xlsx',
    'file ini',
    'berkas ini',
    'lampiran ini',
    'gambar ini',
    'teks ini',
    'isi file',
    'isi dokumen',
    'isi pdf',
    'soal ini',
    'soal',
    'baca',
    'ringkas',
    'rangkum',
    'meringkas',
    'jelaskan',
    'selesaikan',
    'hitung',
    'kerjakan',
    'jawab',
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
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'md';
  if (mimeType === 'text/plain') return 'txt';
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

function buildTelegramFileUrl(filePath?: string | null) {
  if (!filePath) {
    return '';
  }

  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

async function answerActiveDocumentQuestion(ctx: any, question: string, startedAt = Date.now()) {
  const userId = ctx.from.id;
  const stopIndicator = startProcessingIndicator(ctx, 'document');
  const session = await getActiveDocumentSession(userId);
  const adminConfig = await getAdminConfig();
  let stopAnimatedMsg: (() => Promise<void>) | null = null;

  try {
    if (!session) {
      await replySafely(
        ctx,
        formatTelegramRichCard({
          title: 'Dokumen aktif belum ada',
          subtitle: 'Kirim file dulu untuk memulai sesi.',
          badge: 'DOC',
          fields: [
            { label: 'Status', value: 'Belum ada dokumen aktif' },
            { label: 'Saran', value: 'Kirim PDF, gambar, DOCX, atau XLSX terlebih dahulu' },
          ],
          footer: 'Setelah itu, Anda bisa tanya isi file tersebut dengan natural.',
        })
      );
      return true;
    }

    const exportRequest = detectDocumentExportRequest(question);
    if (exportRequest?.format === 'md') {
      stopAnimatedMsg = await startAnimatedProcessingMessage(ctx, await getRuntimeResponse('markdownProcessing'));
    }

    const answer = await answerQuestionAboutDocument(session, question, adminConfig.models.document);
    await logEvent('document.question_answered', {
      userId,
      title: session.title,
      model: answer.model,
      latencyMs: answer.latencyMs,
    });
    
    if (process.env.TELEGRAM_RICH_MESSAGES === 'true') {
      await replySafelyMarkdown(ctx, answer.text);
    } else {
      await replySafely(ctx, renderTelegramMessageContent(answer.text));
    }

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

    const exported = await exportGeneratedContent(ctx, {
      requestText: question,
      title: session.title,
      content: convertRichTelegramToExportText(answer.text),
      source: 'document_answer',
      model: answer.model,
      latencyMs: answer.latencyMs,
      fallback: answer.fallback,
      startedAt,
    });

    if (exported) {
      return true;
    }

    await logEvent('message.completed', {
      userId,
      route: 'document_qa',
      durationMs: Date.now() - startedAt,
    });

    return true;
  } finally {
    stopIndicator();
    if (stopAnimatedMsg) await stopAnimatedMsg();
  }
}

function shouldTreatAsDocumentSendRequest(text: string) {
  const lower = text.toLowerCase();
  
  if (/\b(markdown|md|pdf|docx|word|xlsx|excel)\b/.test(lower)) {
    return false;
  }

  return (
    lower.includes('kirim file') ||
    lower.includes('kirim dokumen') ||
    lower.includes('kirim ulang') ||
    lower.includes('bagikan file') ||
    lower.includes('bagikan dokumen') ||
    lower.includes('kirimkan file') ||
    lower.includes('kirimkan dokumen') ||
    lower.includes('send file') ||
    lower.includes('send document') ||
    lower.includes('file aslinya') ||
    lower.includes('dokumen aslinya') ||
    lower.includes('berkas aslinya')
  );
}

function normalizeModelAlias(model: string) {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'minimax' || lower === 'minimax-m3' || lower === 'mm') {
    return 'tokenrouter:MiniMax-M3';
  }

  return trimmed;
}

function getAvailableModelsText() {
  return (
    `<b>Model yang tersedia</b>\n\n` +
    `<b>Gemini (native)</b>\n` +
    `- <code>gemini:gemini-2.5-flash</code>\n` +
    `- <code>gemini:gemini-2.5-flash-lite</code>\n` +
    `- <code>gemini:gemini-2.5-pro</code>\n\n` +
    `<b>OpenAI-compatible / TokenRouter</b>\n` +
    `- <code>tokenrouter:MiniMax-M3</code>\n\n` +
    `<b>Alias singkat</b>\n` +
    `- <code>minimax</code> = <code>tokenrouter:MiniMax-M3</code>\n` +
    `- <code>/model list</code> atau <code>/models</code> untuk menampilkan daftar ini`
  );
}

function getModelReadinessText() {
  return isOpenAICompatibleConfigured()
    ? `<b>Status provider OpenAI-compatible:</b> siap`
    : `<b>Status provider OpenAI-compatible:</b> belum siap\n` +
      `Isi <code>OPENAI_API_KEY</code> dan <code>OPENAI_BASE_URL=https://api.tokenrouter.com/v1</code>\n` +
      `atau <code>TOKENROUTER_API_KEY</code> dan <code>TOKENROUTER_BASE_URL=https://api.tokenrouter.com/v1</code>.`;
}

function describeModelProvider(model: string) {
  const lower = model.trim().toLowerCase();

  if (lower.startsWith('tokenrouter:') || lower.startsWith('openai:') || lower.startsWith('openai-compatible:')) {
    return 'OpenAI-compatible';
  }

  if (lower.startsWith('gemini:')) {
    return 'Gemini';
  }

  return 'Gemini';
}

function stripHtmlMarkup(text: string) {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function convertRichTelegramToExportText(text: string) {
  return text
    .replace(/<pre><code>/gi, '```\n')
    .replace(/<\/code><\/pre>/gi, '\n```')
    .replace(/<blockquote>/gi, '\n> ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/?(b|strong|i|em|code|s)>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getLatestBotMessage(userId: number) {
  return db.query.messages.findFirst({
    where: eq(messages.userId, userId),
    orderBy: [desc(messages.timestamp), desc(messages.id)],
    columns: {
      id: true,
      content: true,
      role: true,
      intent: true,
    },
  });
}

function shouldExportConversationContent(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes('percakapan ini') ||
    lower.includes('percakapan tadi') ||
    lower.includes('percakapan terakhir') ||
    lower.includes('jawaban terakhir') ||
    lower.includes('jawaban ini') ||
    lower.includes('hasil percakapan') ||
    lower.includes('hasil obrolan') ||
    lower.includes('chat ini') ||
    lower.includes('obrolan ini') ||
    lower.includes('dialog ini') ||
    lower.includes('diskusi ini')
  );
}

function buildConversationExportContent(requestText: string, history: ChatHistoryItem[]) {
  const recent = history.slice(-8);
  const lastUserMessage = [...recent].reverse().find((item) => item.role === 'user')?.content?.trim() || '';
  const lastBotMessage = [...recent].reverse().find((item) => item.role === 'bot')?.content?.trim() || '';
  const transcript = recent
    .map((item, index) => {
      const label = item.role === 'user' ? 'User' : 'Bot';
      return `${index + 1}. ${label}: ${stripHtmlMarkup(item.content.trim())}`;
    })
    .join('\n');

  return [
    '# Percakapan CybraFeriBot',
    '## Permintaan ekspor',
    stripHtmlMarkup(requestText.trim()),
    '## Pertanyaan terakhir',
    stripHtmlMarkup(lastUserMessage) || '(tidak ditemukan)',
    '## Jawaban terakhir',
    stripHtmlMarkup(lastBotMessage) || '(tidak ditemukan)',
    '## Transkrip ringkas',
    transcript || '(transkrip kosong)',
  ].join('\n\n');
}

async function sendActiveDocumentFile(ctx: any, startedAt = Date.now()) {
  const userId = ctx.from.id;
  const session = await getActiveDocumentSession(userId);

  if (!session) {
    await replySafely(ctx, 'Belum ada dokumen aktif untuk dikirim. Kirim file dulu, lalu minta saya kirim ulang.');
    return true;
  }

  const fileSource = session.localFilePath
    ? new InputFile(session.localFilePath, session.title || undefined)
    : session.telegramFilePath
      ? new InputFile(buildTelegramFileUrl(session.telegramFilePath), session.title || undefined)
      : null;

  if (!fileSource) {
    await replySafely(
      ctx,
      formatTelegramRichCard({
        title: 'File asli belum ditemukan',
        subtitle: 'Sesi ada, tetapi file lokal tidak tersedia.',
        badge: 'WARN',
        fields: [
          { label: 'Status', value: 'File sumber belum bisa diakses' },
          { label: 'Saran', value: 'Upload ulang file jika perlu dikirim lagi' },
        ],
      })
    );
    return true;
  }

  const caption =
    `<b>${session.title}</b>\n` +
    `<i>Berikut file yang sedang aktif.</i>`;

  try {
    if (session.mimeType.startsWith('image/')) {
      await ctx.replyWithPhoto(fileSource, {
        caption,
        parse_mode: 'HTML',
      });
    } else {
      await ctx.replyWithDocument(fileSource, {
        caption,
        parse_mode: 'HTML',
      });
    }

    await logEvent('message.completed', {
      userId,
      route: 'document_send',
      durationMs: Date.now() - startedAt,
    });
    return true;
  } catch (error) {
    await logEvent('message.failed', {
      userId,
      chatId: ctx?.chat?.id,
      feature: 'document_send',
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await replySafely(ctx, 'Maaf, saya belum berhasil mengirim file aslinya. Coba lagi sebentar.');
    return true;
  }
}

async function exportGeneratedContent(ctx: any, input: {
  requestText: string;
  title: string;
  content: string;
  source: string;
  model?: string;
  latencyMs?: number;
  fallback?: boolean;
  startedAt: number;
}) {
  const exportRequest = detectDocumentExportRequest(input.requestText);
  if (!exportRequest) {
    return false;
  }

  const userId = ctx.from.id;
  let outputPath = '';

  try {
    const exported = await materializeExportFile(
      input.title || exportRequest.title,
      input.content,
      exportRequest.format,
    );
    outputPath = exported.outputPath;

    await ctx.replyWithDocument(exported.inputFile, {
      caption:
        `Berikut file <b>${exportRequest.format.toUpperCase()}</b> yang saya buat dari hasil terbaru.\n` +
        `<b>Judul:</b> ${input.title || exportRequest.title}`,
      parse_mode: 'HTML',
    });

    await logEvent('document.exported', {
      userId,
      format: exportRequest.format,
      title: input.title || exportRequest.title,
      model: input.model || 'unknown',
      latencyMs: input.latencyMs || 0,
      fallback: Boolean(input.fallback),
      source: input.source,
    });

    await logEvent('message.completed', {
      userId,
      route: `${input.source}_export_${exportRequest.format}`,
      durationMs: Date.now() - input.startedAt,
    });

    return true;
  } catch (error) {
    await logEvent('message.failed', {
      userId,
      chatId: ctx.chat.id,
      feature: 'generated_content_export',
      error: String(error),
      durationMs: Date.now() - input.startedAt,
    }, 'error');
    await replySafely(ctx, await getRuntimeResponse('exportError'));
    return true;
  } finally {
    if (outputPath) {
      cleanupExportFile(outputPath);
    }
  }
}

async function processIncomingDocument(ctx: any, input: {
  fileId: string;
  fileName: string;
  mimeType: string;
  userFacingType: 'pdf' | 'image' | 'document';
  prompt?: string;
}) {
  const startedAt = Date.now();
  const userId = ctx.from.id;
  const stopIndicator = startProcessingIndicator(ctx, input.userFacingType === 'image' ? 'photo' : 'document');
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

  const exportRequest = detectDocumentExportRequest(input.prompt || '');
  const stopAnimatedMsg = await startAnimatedProcessingMessage(
    ctx,
    exportRequest?.format === 'md'
      ? await getRuntimeResponse('markdownProcessing')
      : await getRuntimeResponse('documentProcessing', { fileName: input.fileName })
  );

  try {
    const downloaded = await downloadTelegramFile(input.fileId, input.fileName, input.mimeType);
    const adminConfig = await getAdminConfig();
    const summary = await summarizeDocumentFromPath(
      downloaded.localPath,
      input.mimeType,
      input.fileName,
      input.prompt,
      adminConfig.models.document,
    );
    await saveActiveDocumentSession({
      userId,
      title: input.fileName,
      mimeType: input.mimeType,
      sourceKind: summary.sourceKind,
      localFilePath: downloaded.localPath,
      telegramFileId: input.fileId,
      telegramFilePath: downloaded.telegramFilePath,
      geminiFileName: summary.geminiFileName,
      geminiFileUri: summary.geminiFileUri,
      extractedText: summary.extractedText,
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
      `Untuk bertanya tentang dokumen ini, kirim <b>dokumen: pertanyaan Anda</b>, <b>/dokumen pertanyaan Anda</b>, atau pakai pertanyaan natural yang jelas merujuk ke dokumen aktif.\n` +
      `Kalau perlu, kirim <b>/dokumen_kirim</b> untuk saya kirim ulang file aslinya.`;

    await replySafely(ctx, reply);
    await db.insert(messages).values({
      userId,
      content: reply,
      role: 'bot',
      intent: 'document_summary',
    });

    const exported = await exportGeneratedContent(ctx, {
      requestText: input.prompt || '',
      title: input.fileName,
      content: convertRichTelegramToExportText(summary.summary),
      source: 'document_summary',
      model: summary.model,
      latencyMs: summary.latencyMs,
      fallback: false,
      startedAt,
    });

    if (exported) {
      return;
    }

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
      await getRuntimeResponse('documentError')
    );
  } finally {
    stopIndicator();
    if (stopAnimatedMsg) await stopAnimatedMsg();
    // local file is retained for resend support and cleaned up when the session is replaced or cleared
  }
}

async function processDocumentExport(ctx: any, requestText: string, startedAt: number) {
  const exportRequest = detectDocumentExportRequest(requestText);
  if (!exportRequest) {
    return false;
  }

  const userId = ctx.from.id;
  const stopIndicator = startProcessingIndicator(ctx, 'export');
  const history = await getConversationHistory(userId);
  const preferences = await getUserPreferences(userId);
  const adminConfig = await getAdminConfig();
  const exportFromConversation = shouldExportConversationContent(requestText);

  const stopAnimatedMsg = await startAnimatedProcessingMessage(
    ctx,
    exportRequest.format === 'md'
      ? await getRuntimeResponse('markdownProcessing')
      : getExportProcessingMessage(exportRequest.format)
  );

  let outputPath = '';
  try {
    const repliedMatch = requestText.match(/\[Konteks pesan yang di-reply:\n([\s\S]+?)\n\]/);
    const cleanedRequest = exportRequest.prompt
      .replace(/\[Konteks pesan yang di-reply:[\s\S]*?\]/, '')
      .replace(/\[Konteks Sistem:[\s\S]*?\]/g, '')
      .trim();
    const isDirectConversion = repliedMatch && cleanedRequest.length < 50 && 
      !cleanedRequest.toLowerCase().includes('tambah') && 
      !cleanedRequest.toLowerCase().includes('ubah') && 
      !cleanedRequest.toLowerCase().includes('ringkas');

    let draft;
    if (exportFromConversation) {
      draft = {
        title: 'Percakapan CybraFeriBot',
        text: buildConversationExportContent(requestText, history),
        model: 'local',
        latencyMs: 0,
        fallback: false,
      };
    } else if (isDirectConversion) {
      draft = {
        title: 'Dokumen',
        text: repliedMatch[1],
        model: 'local',
        latencyMs: 0,
        fallback: false,
      };
    } else {
      draft = await generateDocumentDraft(exportRequest.prompt, history, preferences, adminConfig);
    }

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
      source: exportFromConversation ? 'conversation' : 'ai_draft',
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
      await getRuntimeResponse('exportError')
    );
    return true;
  } finally {
    stopIndicator();
    if (stopAnimatedMsg) await stopAnimatedMsg();
    if (outputPath) {
      cleanupExportFile(outputPath);
    }
  }
}

async function exportLatestBotAnswer(ctx: any, format: 'md' | 'pdf' | 'docx' | 'xlsx', titleOverride?: string) {
  const startedAt = Date.now();
  const userId = ctx.from.id;
  const stopIndicator = startProcessingIndicator(ctx, 'export');
  const latestBotMessage = await getLatestBotMessage(userId);

  if (!latestBotMessage || latestBotMessage.role !== 'bot' || !latestBotMessage.content?.trim()) {
    await replySafely(
      ctx,
      'Belum ada jawaban bot yang bisa diekspor. Kirim pertanyaan dulu, lalu pakai <b>/simpan md</b>, <b>/simpan pdf</b>, <b>/simpan docx</b>, atau <b>/simpan xlsx</b>.'
    );
    return;
  }

  const content = latestBotMessage.content.trim();
  const title = titleOverride?.trim() || 'Jawaban CybraFeriBot';
  let outputPath = '';

  let stopAnimatedMsg: (() => Promise<void>) | null = null;
  if (format === 'md') {
    stopAnimatedMsg = await startAnimatedProcessingMessage(ctx, await getRuntimeResponse('markdownProcessing'));
  } else {
    stopAnimatedMsg = await startAnimatedProcessingMessage(ctx, getExportProcessingMessage(format));
  }

  try {
    const exported = await materializeExportFile(title, content, format);
    outputPath = exported.outputPath;

    await ctx.replyWithDocument(exported.inputFile, {
      caption:
        `Berikut file <b>${format.toUpperCase()}</b> dari jawaban terakhir Cybra.\n` +
        `<b>Judul:</b> ${title}`,
      parse_mode: 'HTML',
    });

    await logEvent('document.exported', {
      userId,
      format,
      title,
      source: 'latest_bot_answer',
    });

    await logEvent('message.completed', {
      userId,
      route: `latest_answer_export_${format}`,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await logEvent('message.failed', {
      userId,
      chatId: ctx.chat.id,
      feature: 'latest_answer_export',
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await replySafely(ctx, await getRuntimeResponse('exportError'));
  } finally {
    stopIndicator();
    if (stopAnimatedMsg) await stopAnimatedMsg();
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

async function handleExplicitSkillCommand(
  ctx: any,
  options: {
    command: 'grill' | 'humanis';
    requestedSkillId: 'grill-me' | 'penjelasan-humanis';
    emptyPrompt: string;
  }
) {
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  const startedAt = Date.now();
  const stopIndicator = startProcessingIndicator(ctx, 'text');
  let stopAnimatedMsg: (() => Promise<void>) | null = null;
  try {
    const rawText = ctx.message?.text || '';
    const text = rawText.replace(new RegExp(`^/${options.command}(@\\w+)?`, 'i'), '').trim();

    if (!text) {
      await replySafely(ctx, options.emptyPrompt);
      return;
    }

    const userId = ctx.from.id;
    await ensureUserRegistered(ctx.from);
    const adminConfig = await getAdminConfig();
    const history = await getConversationHistory(userId);
    const intentResult = await getIntent(text, adminConfig);
    const exportRequest = detectDocumentExportRequest(text);

    if (exportRequest?.format === 'md') {
      stopAnimatedMsg = await startAnimatedProcessingMessage(ctx, await getRuntimeResponse('markdownProcessing'));
    }

    await logEvent('message.received', {
      userId,
      chatId: ctx.chat.id,
      messageLength: rawText.length,
      normalizedLength: text.length,
      chatType: ctx.chat?.type,
      route: `command_${options.command}`,
    });

    await db.insert(messages).values({
      userId,
      content: rawText,
      role: 'user',
      intent: options.requestedSkillId,
    });

    const response = await runSkillChat({
      message: text,
      history,
      adminConfig,
      requestedSkillId: options.requestedSkillId,
      intentHint: intentResult,
      surface: 'telegram',
    });

    await logEvent('message.ai_used', {
      userId,
      route: `command_${options.command}`,
      skillId: response.skill?.id || options.requestedSkillId,
      intent: response.intent,
      intentModel: response.intentModel,
      model: response.model,
      latencyMs: response.latencyMs,
      knowledgeMatches: response.knowledgeMatches,
      fallback: response.fallback,
      reach: response.reach,
    });

    if (process.env.TELEGRAM_RICH_MESSAGES === 'true') {
      await replySafelyMarkdown(ctx, response.reply);
    } else {
      await replySafely(ctx, renderTelegramMessageContent(response.reply));
    }

    if (response.exportFile) {
      await ctx.replyWithDocument(new InputFile(response.exportFile.outputPath, response.exportFile.fileName), {
        caption:
          `Berikut file markdown hasil penjelasan humanis.\n` +
          `<b>Skill:</b> ${response.skill?.title || 'Penjelasan Humanis'}\n` +
          `<b>Format:</b> MD`,
        parse_mode: 'HTML',
      });
    }

    await db.insert(messages).values({
      userId,
      content: response.reply,
      role: 'bot',
      intent: response.skill?.id || options.requestedSkillId,
    });

    await logEvent('message.completed', {
      userId,
      route: `command_${options.command}`,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    stopIndicator();
    if (stopAnimatedMsg) await stopAnimatedMsg();
  }
}

bot.on('message:new_chat_members', async (ctx) => {
  const members = ctx.message.new_chat_members;
  for (const member of members) {
    if (!member.is_bot) {
      await trackGroupMember(ctx.chat.id, member).catch(() => {});
    }
  }
});

bot.command('absen', async (ctx) => {
  if (!isGroupChat(ctx)) {
    return replySafely(ctx, 'Perintah ini hanya bisa digunakan di dalam grup.');
  }
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  const members = await db.query.groupMembers.findMany({
    where: eq(groupMembers.chatId, ctx.chat.id),
  });

  if (members.length === 0) {
    return replySafely(ctx, 'Belum ada anggota grup yang terekam di radar Cybra.');
  }

  const mentions = members.map(m => {
    if (m.username) return `@${m.username}`;
    return `<a href="tg://user?id=${m.userId}">${escapeHtml(m.firstName || 'Anggota')}</a>`;
  }).join(' ');

  await replySafely(ctx, `📢 **Panggilan kepada semua anggota grup yang terekam di radar Cybra:**\n\n${mentions}`);
});

bot.command('start', async (ctx) => {
  try {
    if (!shouldHandleGroupCommand(ctx)) {
      return;
    }

    const { first_name } = ctx.from!;
    await ensureUserRegistered(ctx.from!);

    const config = await getAdminConfig();
    await replySafely(
      ctx,
      formatTelegramRichCard({
        title: `Halo Kakak ${first_name}!`,
        subtitle: 'Sesi siap dipakai.',
        badge: 'NEW',
        fields: [
          { label: 'Bot', value: '@CybraFeriBot' },
          { label: 'Model Chat', value: escapeHtml(config.models.chat) },
          { label: 'Provider', value: isOpenAICompatibleConfigured() ? 'OpenAI-compatible' : 'Gemini' },
          { label: 'Tip', value: 'Gunakan /model untuk mengganti model aktif.' },
        ],
        footer: 'Ada yang bisa saya bantu hari ini?',
      })
    );
  } catch (error) {
    console.error('Error in /start command:', error);
    await replySafely(
      ctx,
      formatTelegramRichCard({
        title: 'Start gagal',
        subtitle: 'Ada gangguan saat memulai sesi bot.',
        badge: 'ERR',
        fields: [
          { label: 'Status', value: 'Silakan coba lagi nanti' },
        ],
      })
    );
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
        formatTelegramRichCard({
          title: 'Dokumen aktif belum ada',
          subtitle: 'Sesi belum dimulai.',
          badge: 'DOC',
          fields: [
            { label: 'Aksi', value: 'Kirim PDF/gambar/DOCX/XLSX dulu' },
            { label: 'Lalu', value: 'Gunakan /dokumen pertanyaan Anda' },
          ],
          footer: 'Anda juga bisa pakai caption saat upload untuk memberi instruksi awal.',
        })
      );
      return;
    }

    await replySafely(
      ctx,
      formatTelegramRichCard({
        title: session.title,
        subtitle: 'Dokumen aktif saat ini',
        badge: 'ACTIVE',
        fields: [
          { label: 'Ringkasan', value: session.summary || 'Belum ada ringkasan singkat.' },
          { label: 'Tanya', value: 'Gunakan /dokumen pertanyaan Anda' },
        ],
        footer: 'Dokumen ini akan dipakai sampai Anda reset atau ganti sesi.',
      })
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
  await replySafely(
    ctx,
    formatTelegramRichCard({
      title: 'Dokumen aktif dihapus',
      subtitle: 'Sesi dokumen selesai.',
      badge: 'OK',
      fields: [
        { label: 'Status', value: 'Dokumen aktif sudah di-reset' },
        { label: 'Lanjut', value: 'Kirim file baru untuk memulai sesi baru' },
      ],
    })
  );
});

bot.command('dokumen_kirim', async (ctx) => {
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  await sendActiveDocumentFile(ctx);
});

bot.command('simpan', async (ctx) => {
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/simpan(@\w+)?/i, '').trim();
  const [formatRaw, ...titleParts] = raw.split(/\s+/);
  const format = (formatRaw || '').toLowerCase() as 'md' | 'pdf' | 'docx' | 'xlsx';
  const title = titleParts.join(' ').trim();

  if (!format || !['md', 'pdf', 'docx', 'xlsx'].includes(format)) {
    await replySafely(
      ctx,
      'Format: <b>/simpan [md|pdf|docx|xlsx] [judul opsional]</b>\n' +
      'Contoh: <b>/simpan pdf kondisi-indonesia</b>'
    );
    return;
  }

  await exportLatestBotAnswer(ctx, format, title);
});

bot.command('grill', async (ctx) => {
  await handleExplicitSkillCommand(ctx, {
    command: 'grill',
    requestedSkillId: 'grill-me',
    emptyPrompt:
      'Format: <b>/grill topik atau jawaban yang mau diuji</b>\n' +
      'Contoh: <b>/grill uji saya tentang trigonometri dasar</b>',
  });
});

bot.command('humanis', async (ctx) => {
  await handleExplicitSkillCommand(ctx, {
    command: 'humanis',
    requestedSkillId: 'penjelasan-humanis',
    emptyPrompt:
      'Format: <b>/humanis topik yang mau dijelaskan</b>\n' +
      'Contoh: <b>/humanis jelaskan RAG dengan bahasa awam dan kasih analogi</b>',
  });
});

bot.command('rich', async (ctx) => {
  if (!shouldHandleGroupCommand(ctx)) {
    return;
  }

  await (ctx.api as any).sendRichMessage({
    chat_id: ctx.chat.id,
    rich_message: {
      markdown: "## Demo Rich Message Telegram\n\nFitur ini menggunakan Bot API 10.1 untuk menampilkan *rich text*!\n\n> Ini adalah block quotation. Sangat berguna untuk mengutip sesuatu secara elegan.\n\nContoh elemen lainnya:\n- **Teks tebal**\n- *Teks miring*\n- ==Teks di-highlight==\n- ||Spoiler||\n\n| Kolom Kiri | Kolom Kanan |\n|:---|:---|\n| Baris 1 | Data |\n| Baris 2 | Data |\n\n**CybraFeriBot** sekarang semakin keren! 🚀"
    }
  });
});

bot.command('admin_status', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const config = await getAdminConfig();
  await replySafely(
    ctx,
    formatTelegramRichCard({
      title: 'Status Admin CybraFeriBot',
      subtitle: 'Ringkasan runtime config',
      badge: 'ADMIN',
      fields: [
        { label: 'Tools', value: `math:${config.enabledTools.math ? 'on' : 'off'}, caption:${config.enabledTools.caption ? 'on' : 'off'}, announcement:${config.enabledTools.announcement ? 'on' : 'off'}, faq:${config.enabledTools.faq ? 'on' : 'off'}` },
        { label: 'Models', value: `chat:${config.models.chat}, intent:${config.models.intent}, document:${config.models.document}` },
        { label: 'Persona', value: config.personaOverride ? 'active' : 'empty' },
        { label: 'Self templates', value: 'ready' },
      ],
    })
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

bot.command('agent', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const prompt = ctx.message!.text.replace(/^\/agent(@\w+)?/i, '').trim();
  if (!prompt) {
    await replySafely(ctx, 'Format: <b>/agent [perintah atau pertanyaan]</b>\nContoh: <i>/agent tolong cek daftar file di dalam folder /tmp</i>');
    return;
  }

  let updateMessageId: number | null = null;
  const updateStatus = async (msg: string) => {
    try {
      if (!updateMessageId) {
        const sent = await ctx.reply(`<i>Agent: ${msg}</i>`, { parse_mode: 'HTML' });
        updateMessageId = sent.message_id;
      } else {
        await ctx.api.editMessageText(ctx.chat.id, updateMessageId, `<i>Agent: ${msg}</i>`, { parse_mode: 'HTML' });
      }
    } catch (e) {
      // Ignore edit errors
    }
  };

  const sendDocument = async (filePath: string, caption?: string) => {
    await ctx.replyWithDocument(new InputFile(filePath), { caption });
  };

  try {
    const result = await runAgentLoop(prompt, updateStatus, sendDocument);
    
    if (updateMessageId) {
      await ctx.api.deleteMessage(ctx.chat.id, updateMessageId).catch(() => {});
    }

    await replySafely(ctx, result.html);
  } catch (error: any) {
    if (updateMessageId) {
      await ctx.api.deleteMessage(ctx.chat.id, updateMessageId).catch(() => {});
    }
    await replySafely(ctx, `❌ Gagal mengeksekusi agent:\n<pre>${escapeHtml(error.message || String(error))}</pre>`);
  }
});

bot.command('model', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const config = await getAdminConfig();
  const raw = ctx.message!.text.replace(/^\/model(@\w+)?/i, '').trim();

  if (!raw || raw.toLowerCase() === 'list' || raw.toLowerCase() === 'help') {
    await replySafely(
      ctx,
      formatTelegramRichCard({
        title: 'Model aktif saat ini',
        subtitle: 'Konfigurasi runtime bot',
        badge: 'MODEL',
        fields: [
          { label: 'Chat', value: `<code>${escapeHtml(config.models.chat)}</code>` },
          { label: 'Intent', value: `<code>${escapeHtml(config.models.intent)}</code>` },
          { label: 'Document', value: `<code>${escapeHtml(config.models.document)}</code>` },
          { label: 'Provider', value: isOpenAICompatibleConfigured() ? 'siap' : 'belum siap' },
        ],
        footer:
          `${getAvailableModelsText()}\n\n` +
          `<b>Contoh update</b>\n` +
          `<code>/model chat gemini:gemini-2.5-pro</code>\n` +
          `<code>/model chat minimax</code>\n` +
          `<code>/model intent gemini:gemini-2.5-flash-lite</code>\n` +
          `<code>/model document gemini:gemini-2.5-flash</code>\n` +
          `<code>/model all gemini:gemini-2.5-flash</code>\n\n` +
          `${getModelReadinessText()}`
      })
    );
    return;
  }

  const [targetRaw, ...modelParts] = raw.split(/\s+/);
  const singleToken = !modelParts.length;
  const target = singleToken ? 'chat' : targetRaw?.toLowerCase();
  const model = normalizeModelAlias(singleToken ? (targetRaw || '') : modelParts.join(' ').trim());

  if (!target || !model) {
    await replySafely(
      ctx,
      `Format:\n` +
      `<code>/model chat gemini:gemini-2.5-pro</code>\n` +
      `<code>/model chat minimax</code>\n` +
      `<code>/model intent gemini:gemini-2.5-flash-lite</code>\n` +
      `<code>/model document gemini:gemini-2.5-flash</code>\n` +
      `<code>/model all gemini:gemini-2.5-flash</code>\n\n` +
      `${getModelReadinessText()}\n\n` +
      `${getAvailableModelsText()}`
    );
    return;
  }

  const updates =
    target === 'all'
      ? { models: { chat: model, intent: model, document: model } }
      : target === 'chat'
        ? { models: { chat: model } }
        : target === 'intent'
          ? { models: { intent: model } }
          : target === 'document'
            ? { models: { document: model } }
            : null;

  if (!updates) {
    await replySafely(
      ctx,
      `Target valid: <code>chat</code>, <code>intent</code>, <code>document</code>, atau <code>all</code>.`
    );
    return;
  }

  const updated = await saveAdminConfig(updates as any);
  await replySafely(
    ctx,
    formatTelegramRichCard({
      title: 'Model diperbarui',
      subtitle: 'Runtime config tersimpan',
      badge: 'OK',
      fields: [
        { label: 'Chat', value: `<code>${escapeHtml(updated.models.chat)}</code>` },
        { label: 'Intent', value: `<code>${escapeHtml(updated.models.intent)}</code>` },
        { label: 'Document', value: `<code>${escapeHtml(updated.models.document)}</code>` },
        { label: 'Provider', value: isOpenAICompatibleConfigured() ? 'siap' : 'belum siap' },
      ],
      footer: getModelReadinessText(),
    })
  );
});

bot.command('models', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const config = await getAdminConfig();
  await replySafely(
    ctx,
    `<b>Model aktif saat ini</b>\n\n` +
    `- chat: <code>${config.models.chat}</code>\n` +
    `- intent: <code>${config.models.intent}</code>\n` +
    `- document: <code>${config.models.document}</code>\n\n` +
    `${getModelReadinessText()}\n\n` +
    `${getAvailableModelsText()}`
  );
});

bot.command('quota', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const config = await getAdminConfig();
  const status = await getProviderQuotaStatus();
  const chatProvider = describeModelProvider(config.models.chat);

  const statusText = status.ok
    ? `Tersedia\nEndpoint: ${status.endpoint}\n\n${status.summary}`
    : `Belum bisa dibaca\n${status.endpoint ? `Endpoint dicek: ${status.endpoint}\n` : ''}${status.summary}`;

  await replySafely(
    ctx,
    formatTelegramRichCard({
      title: 'Status Kuota Token',
      subtitle: 'Provider yang dipakai model aktif',
      badge: 'QUOTA',
      fields: [
        { label: 'Model Chat', value: `<code>${escapeHtml(config.models.chat)}</code>` },
        { label: 'Provider', value: escapeHtml(chatProvider) },
        { label: 'Intent', value: `<code>${escapeHtml(config.models.intent)}</code>` },
        { label: 'Document', value: `<code>${escapeHtml(config.models.document)}</code>` },
      ],
      footer: `<b>Status provider:</b>\n<pre>${escapeHtml(statusText)}</pre>\n\n<i>Kalau model chat masih Gemini, kuota TokenRouter/OpenAI-compatible memang tidak relevan.</i>`,
    })
  );
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

bot.command('admin_skill_add', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_skill_add(@\w+)?/i, '').trim();
  const [idLine, titleLine, descriptionLine, triggersLine, ...instructionsLines] = raw.split('\n');
  const id = idLine?.trim();
  const title = titleLine?.trim();
  const description = descriptionLine?.trim();
  const triggers = triggersLine?.split(',').map((t) => t.trim()).filter(Boolean);
  const instructions = instructionsLines.join('\n').trim();

  if (!id || !title || !description || !triggers || !instructions) {
    await replySafely(
      ctx,
      `Format:\n<b>/admin_skill_add id-skill</b>\nJudul Skill\nDeskripsi singkat\ntrigger1, trigger2, trigger3\nInstruksi lengkap bot`
    );
    return;
  }

  saveWebSkill({ id, title, description, triggers, instructions, modelHint: 'chat' });
  await replySafely(ctx, `Skill <b>${title}</b> (${id}) berhasil ditambahkan/diperbarui!`);
});

bot.command('admin_skill_delete', async (ctx) => {
  if (!(await requireOwner(ctx))) {
    return;
  }

  const raw = ctx.message!.text.replace(/^\/admin_skill_delete(@\w+)?/i, '').trim();
  if (!raw) {
    await replySafely(ctx, 'Format: <b>/admin_skill_delete id-skill</b>');
    return;
  }

  deleteWebSkill(raw);
  await replySafely(ctx, `Skill <b>${raw}</b> dihapus.`);
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

  if (
    !mimeType ||
    (
      mimeType !== 'application/pdf' &&
      !mimeType.startsWith('image/') &&
      mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      !mimeType.startsWith('text/')
    )
  ) {
    await replySafely(ctx, 'Saat ini saya hanya mendukung file <b>PDF</b>, <b>gambar</b>, <b>DOCX</b>, <b>XLSX</b>, atau <b>MD/TXT</b>.');
    return;
  }
  if (fileSize > MAX_DOCUMENT_BYTES) {
    await replySafely(ctx, `Ukuran file terlalu besar. Batas saat ini sekitar <b>${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}MB</b>.`);
    return;
  }

  try {
    await processIncomingDocument(ctx, {
      fileId: document.file_id,
      fileName,
      mimeType,
      userFacingType:
        mimeType === 'application/pdf'
          ? 'pdf'
          : mimeType.startsWith('image/')
            ? 'image'
            : 'document',
      prompt: normalizeIncomingText(caption, ctx) || undefined,
    });
  } catch (error) {
    console.error('Error processing document:', error);
    await replySafely(ctx, 'Maaf, terjadi kesalahan internal saat memproses dokumen ini.');
  }
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

  try {
    await processIncomingDocument(ctx, {
      fileId: photo.file_id,
      fileName: `photo-${photo.file_unique_id}.jpg`,
      mimeType: 'image/jpeg',
      userFacingType: 'image',
      prompt: normalizeIncomingText(caption, ctx) || undefined,
    });
  } catch (error) {
    console.error('Error processing photo:', error);
    await replySafely(ctx, 'Maaf, terjadi kesalahan internal saat memproses gambar ini.');
  }
});

bot.on('message:text', async (ctx) => {
  const startedAt = Date.now();
  let failureStage = 'startup';
  let normalizedTextForLog = '';
  let stopIndicator: (() => void) | undefined;
  try {
    if (isFromBotAccount(ctx)) {
      return;
    }

    const rawText = ctx.message.text;
    if (!shouldHandleGroupText(ctx, rawText)) {
      return;
    }

    const exportRequest = detectDocumentExportRequest(rawText);
    stopIndicator = startProcessingIndicator(ctx, exportRequest ? 'export' : 'text');

    let text = normalizeIncomingText(rawText, ctx);
    
    if (ctx.message.reply_to_message) {
      const replyTo = ctx.message.reply_to_message;
      const repliedText = replyTo.text || replyTo.caption;
      if (repliedText) {
        text += `\n\n[Konteks pesan yang di-reply:\n${repliedText}\n]`;
      }
    }

    if (isGroupChat(ctx)) {
       try {
         const members = await db.query.groupMembers.findMany({
           where: eq(groupMembers.chatId, ctx.chat.id)
         });
         if (members.length > 0) {
           const memberList = members.map(m => m.username ? `@${m.username}` : m.firstName).join(', ');
           text += `\n\n[Konteks Sistem: Ini adalah pesan di grup. Daftar anggota grup yang terekam: ${memberList}. Jika diminta menyapa, sebutkan username mereka dan berikan sapaan yang hangat/luwes.]`;
           
           const mentionedUsernames = (rawText.match(/@([a-zA-Z0-9_]+)/g) || []).map(u => u.slice(1).toLowerCase());
           for (const username of mentionedUsernames) {
             const member = members.find(m => m.username?.toLowerCase() === username);
             if (member) {
               const userMessages = await db.query.messages.findMany({
                 where: eq(messages.userId, member.userId),
                 orderBy: [desc(messages.timestamp)],
                 limit: 20,
               });
               if (userMessages.length > 0) {
                 const historyText = userMessages.map(m => m.content).reverse().join('\n- ');
                 text += `\n\n[Konteks Sistem: Pengguna me-mention @${username}. Berikut adalah 20 pesan terakhir dari @${username} jika kamu diminta menganalisis karakternya atau membalas berdasarkan riwayatnya:\n- ${historyText}\n]`;
               }
             }
           }
         }
       } catch (e) {
         console.warn('Gagal memuat konteks anggota grup (mungkin tabel group_members belum ada):', e);
       }
    }

    normalizedTextForLog = text;
    const userId = ctx.from.id;
    await ensureUserRegistered(ctx.from);
    const adminConfig = await getAdminConfig();

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

    const analysis = analyzeText(text);
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

    if (activeDocument && shouldTreatAsDocumentSendRequest(text)) {
      await sendActiveDocumentFile(ctx, startedAt);
      return;
    }

    const preferenceUpdate = detectPreferenceUpdate(text);
    if (preferenceUpdate) {
      failureStage = 'save_preferences';
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

    const toolResult = runLocalTool(text, adminConfig);

    if (toolResult.handled && toolResult.response) {
      failureStage = 'save_user_message_tool';
      await db.insert(messages).values({
        userId,
        content: rawText,
        role: 'user',
        intent: toolResult.toolName || 'tool',
      });
      await logEvent('message.tool_used', {
        userId,
        toolName: toolResult.toolName,
        metadata: toolResult.metadata || {},
      });
      failureStage = 'reply_tool';
      if (typeof toolResult.metadata?.photoPath === 'string') {
        try {
          const captionHtml = formatInlineTelegramRichText(toolResult.response);
          await ctx.replyWithPhoto(new InputFile(toolResult.metadata.photoPath), {
            caption: captionHtml,
            parse_mode: 'HTML',
          });
        } catch (e) {
          console.error('Gagal mengirim foto profil Dianyssa', e);
          await replySafely(ctx, toolResult.response);
        }
      } else {
        await replySafely(ctx, toolResult.response);
      }

      failureStage = 'save_tool_response';
      await db.insert(messages).values({
        userId,
        content: toolResult.response,
        role: 'bot',
        intent: toolResult.toolName || 'tool',
      });

      await logEvent('message.completed', {
        userId,
        route: toolResult.toolName === 'self_describe' ? 'self_describe' : 'tool',
        durationMs: Date.now() - startedAt,
      });

      return;
    }

    failureStage = 'intent_classification';
    const intentResult = await getIntent(text, adminConfig);
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

    failureStage = 'save_user_message_ai';
    await db.insert(messages).values({
      userId,
      content: rawText,
      role: 'user',
      intent: intentResult.intent,
    });

    failureStage = 'load_history';
    const history = await getConversationHistory(userId);

    failureStage = 'skill_chat';
    const response = await runSkillChat({
      message: text,
      history,
      adminConfig,
      intentHint: intentResult,
      surface: 'telegram',
    });
    failureStage = 'telegram_format';
    
    await logEvent('message.ai_used', {
      userId,
      route: response.route,
      skillId: response.skill?.id || null,
      intent: response.intent,
      intentModel: response.intentModel,
      model: response.model,
      latencyMs: response.latencyMs,
      knowledgeMatches: response.knowledgeMatches,
      fallback: response.fallback,
      reach: response.reach,
    });
    failureStage = 'reply_ai';
    if (process.env.TELEGRAM_RICH_MESSAGES === 'true') {
      await replySafelyMarkdown(ctx, response.reply);
    } else {
      await replySafely(ctx, renderTelegramMessageContent(response.reply));
    }

    if (response.exportFile) {
      failureStage = 'reply_export_file';
      await ctx.replyWithDocument(new InputFile(response.exportFile.outputPath, response.exportFile.fileName), {
        caption:
          `Berikut file markdown hasil penjelasan humanis.\n` +
          `<b>Skill:</b> ${response.skill?.title || 'Penjelasan Humanis'}\n` +
          `<b>Format:</b> MD`,
        parse_mode: 'HTML',
      });
    }

    failureStage = 'save_ai_response';
    await db.insert(messages).values({
      userId,
      content: response.reply,
      role: 'bot',
      intent: response.skill?.id || response.intent,
    });

    await logEvent('message.completed', {
      userId,
      route: `skill_${response.skill?.id || response.intent}`,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await logEvent('message.failed', {
      userId: ctx?.from?.id,
      chatId: ctx?.chat?.id,
      stage: failureStage,
      textPreview: normalizedTextForLog.slice(0, 280),
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await replySafely(ctx, await getRuntimeResponse('aiError'));
  } finally {
    stopIndicator?.();
  }
});

bot.catch(async (err) => {
  const ctx = err.ctx;
  console.error(`[Grammy Error] Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  console.error(e);
  
  await logEvent('telegram.webhook_error', {
    updateId: ctx.update?.update_id ?? null,
    chatId: ctx.chat?.id ?? null,
    error: String(e),
  }, 'error').catch(() => {});
});

export const handleUpdate = (c: any) => webhookCallback(bot, 'hono', 'return', 60000)(c);
