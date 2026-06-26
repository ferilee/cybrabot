import { bot } from './bot/index.ts';

async function test() {
  try {
    const res = await (bot.api as any).sendRichMessage({
      chat_id: 177517779,
      rich_message: { markdown: "Test" }
    });
    console.log("Success:", res);
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

test();
