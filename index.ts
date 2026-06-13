import { serve } from 'bun';
import app from './api';
import 'dotenv/config';

const port = Number(process.env.PORT || 4129);

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN is missing! Bot features will not work.");
}
if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY/GOOGLE_API_KEY is missing! AI features will not work.");
}

console.log(`🚀 CybraFeriBot is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: port,
});
