import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { desc, eq } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { generateResponse, generateTechnicalResponse, getIntent, type ChatHistoryItem } from '../lib/ai';

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
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    console.log(`📩 Received message from ${userId}: ${text}`);

    // 1. NLP Analysis
    const analysis = analyzeText(text);
    
    // 2. AI Intent Routing
    const intent = await getIntent(text);

    // 3. Save User Message
    await db.insert(messages).values({
      userId,
      content: text,
      role: 'user',
      intent,
    });

    const history = await getConversationHistory(userId);
    const lowerText = text.toLowerCase();

    if (intent === 'technical') {
      const response = await generateTechnicalResponse(text, history);
      await replySafely(ctx, response);

      await db.insert(messages).values({
        userId,
        content: response,
        role: 'bot',
        intent: 'technical',
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
        return;
      }

      // 5. Casual Chat with LLM
      const response = await generateResponse(text, history);
      await replySafely(ctx, response);
      
      // Save Bot Response
      await db.insert(messages).values({
        userId,
        content: response,
        role: 'bot',
        intent: 'casual',
      });
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    await ctx.reply('Aduh, sepertinya otak digital saya sedikit korsleting. Bisa ulangi pertanyaannya? 🤖');
  }
});

export const handleUpdate = (c: any) => webhookCallback(bot, 'hono')(c);
