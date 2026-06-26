import { bot } from './bot/index.ts';
await bot.init();
bot.handleUpdate({
  update_id: 12345,
  message: {
    message_id: 1,
    date: Date.now() / 1000,
    chat: { id: 177517779, type: 'private' },
    from: { id: 177517779, is_bot: false, first_name: 'Feri' },
    text: 'halo'
  }
}).then(() => console.log('Update handled!')).catch(console.error);
