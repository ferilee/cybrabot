import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { desc, eq } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { generateResponse, generateTechnicalResponse, getIntent, type ChatHistoryItem } from '../lib/ai';
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
    const { id, username, first_name } = ctx.from!;
    
    // Register user if not exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!existingUser) {
      await db.insert(users).values({
        id,
        username,
        firstName: first_name,
      });
    }

    await replySafely(ctx, `Halo <b>Kakak ${first_name}</b>! Saya @CybraFeriBot. Ada yang bisa saya bantu hari ini? 🚀`);
  } catch (error) {
    console.error('Error in /start command:', error);
    await ctx.reply('Terjadi kesalahan saat memulai bot. Silakan coba lagi nanti.');
  }
});

bot.on('message:text', async (ctx) => {
  const startedAt = Date.now();
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    logEvent('message.received', {
      userId,
      chatId: ctx.chat.id,
      messageLength: text.length,
    });

    // 1. NLP Analysis
    const analysis = analyzeText(text);
    
    // 2. AI Intent Routing
    const intentResult = await getIntent(text);
    logEvent('message.intent_classified', {
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
    const preferenceUpdate = detectPreferenceUpdate(text);
    if (preferenceUpdate) {
      const savedPreferences = await saveUserPreferences(userId, preferenceUpdate);
      const confirmation = formatPreferenceConfirmation(savedPreferences);
      logEvent('message.preference_updated', {
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
    const toolResult = runLocalTool(text);

    if (toolResult.handled && toolResult.response) {
      logEvent('message.tool_used', {
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

      logEvent('message.completed', {
        userId,
        route: 'tool',
        durationMs: Date.now() - startedAt,
      });

      return;
    }

    if (intentResult.intent === 'technical') {
      const response = await generateTechnicalResponse(text, history, preferences);
      logEvent('message.ai_used', {
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

      logEvent('message.completed', {
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

        logEvent('message.completed', {
          userId,
          route: 'local_about',
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // 5. Casual Chat with LLM
      const response = await generateResponse(text, history, preferences);
      logEvent('message.ai_used', {
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

      logEvent('message.completed', {
        userId,
        route: 'casual_ai',
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (error) {
    logEvent('message.failed', {
      error: String(error),
      durationMs: Date.now() - startedAt,
    }, 'error');
    await ctx.reply('Aduh, sepertinya otak digital saya sedikit korsleting. Bisa ulangi pertanyaannya? 🤖');
  }
});

export const handleUpdate = (c: any) => webhookCallback(bot, 'hono')(c);
