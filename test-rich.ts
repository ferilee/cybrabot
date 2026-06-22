import { Bot } from 'grammy';
import 'dotenv/config';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
bot.api.callApi('sendRichMessage', {
  chat_id: 112185548, // Ferilee's telegram ID? I can just use a dummy ID or I can just catch the error to see what Telegram says
  rich_message: { markdown: "Hello" }
} as any).catch(e => console.log(e.description));
