import app from './api/index.ts';
import { getWebChatSkills } from './lib/web-chat.ts';

async function test() {
  console.log("Testing getWebChatSkills()...");
  try {
    const skills = getWebChatSkills();
    console.log("Skills returned:", skills.length);
  } catch (err) {
    console.error("Error in getWebChatSkills:", err);
  }

  console.log("\nTesting /chat endpoint...");
  try {
    const req = new Request('http://localhost/chat');
    const res = await app.fetch(req);
    console.log("Status:", res.status);
    console.log("Headers:", Object.fromEntries(res.headers));
    const text = await res.text();
    console.log("Body preview:", text.slice(0, 200));
  } catch (err) {
    console.error("Error in /chat endpoint:", err);
  }
}

test();
