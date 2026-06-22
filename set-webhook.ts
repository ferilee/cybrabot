import { Bot } from 'grammy';
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token.startsWith('123456')) {
  console.error('⚠️ Token Telegram tidak valid di .env');
  process.exit(1);
}

const bot = new Bot(token);
const domain = process.argv[2];

if (!domain) {
  console.error('❌ Harap masukkan domain publik Anda.');
  console.error('Contoh: bun run set-webhook.ts https://bot.domain.com');
  process.exit(1);
}

async function run() {
  const webhookUrl = `${domain}/api/webhook`;
  console.log(`Menyiapkan webhook ke: ${webhookUrl}...`);
  
  try {
    await bot.api.setWebhook(webhookUrl);
    console.log('✅ Webhook berhasil diatur!');
  } catch (err: any) {
    console.error('❌ Gagal mengatur webhook:', err.message);
  }
}

run();
