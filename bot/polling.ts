import { bot } from './index';
import 'dotenv/config';

console.log('🤖 CybraFeriBot is starting in Long Polling mode...');

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is online!`);
    console.log('🚀 You can now chat with the bot directly on Telegram.');
  },
});
