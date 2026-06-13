import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { analyzeText } from '../lib/nlp';
import { getIntent, generateResponse } from '../lib/ai';

const token = process.env.TELEGRAM_BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
if (token.startsWith('123456')) {
  console.warn("⚠️ Using default placeholder token! Check your .env file.");
} else {
  console.log("✅ Telegram token loaded successfully.");
}
export const bot = new Bot(token);

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

    await ctx.reply(`Halo <b>Kakak ${first_name}</b>! Saya @CybraFeriBot. Ada yang bisa saya bantu hari ini? 🚀`, { parse_mode: 'HTML' });
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

    if (intent === 'technical') {
      if (analysis.hasNumbers) {
        await ctx.reply(`Wah, ada angka-angka nih. Sebagai asisten teknis, Kakak tenang saja, saya sedang mempelajari modul matematika lanjut buat bantu Kakak nanti! 💡`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`Pesan teknis Kakak sudah saya terima. Akan segera saya proses sesuai protokol @CybraFeriBot ya!`, { parse_mode: 'HTML' });
      }
    } else {
      // 4. Local Keyword Handling (to save AI quota)
      const lowerText = text.toLowerCase();
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
        await ctx.reply(feriInfo, { parse_mode: 'HTML' });
        
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
      const response = await generateResponse(text);
      await ctx.reply(response, { parse_mode: 'HTML' });
      
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
    await ctx.reply('Aduh, sepertinya otak digital saya sedikit korsleting. Bisa ulangi pertanyaannya? 🤖', { parse_mode: 'HTML' });
  }
});

export const handleUpdate = (c: any) => webhookCallback(bot, 'hono')(c);
