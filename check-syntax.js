import { readFileSync } from 'fs';
const file = readFileSync('api/index.ts', 'utf8');
const scripts = [...file.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const chatScriptMatch = scripts.find(m => m[1].includes("document.getElementById('skillList')"));
if (chatScriptMatch) {
  let chatScript = chatScriptMatch[1];
  chatScript = chatScript.replace(/\$\{JSON\.stringify\([^)]+\)\}/g, '""');
  require('fs').writeFileSync('test-script.js', chatScript);
  console.log("Checking chat script syntax...");
  try {
    new Function(chatScript);
    console.log("Syntax OK!");
  } catch(e) {
    console.error("Syntax Error:", e);
  }
}
