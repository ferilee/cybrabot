const requestText = `dianyssa jadikan pdf

[Konteks pesan yang di-reply:
Halo teman-teman, ini adalah RPP matematika.
Tolong dipelajari ya.
]`;

const prompt = requestText; // simulated cleanedPrompt

const repliedMatch = requestText.match(/\[Konteks pesan yang di-reply:\n([\s\S]+?)\n\]/);
const cleanedRequest = prompt
  .replace(/\[Konteks pesan yang di-reply:[\s\S]*?\]/, '')
  .replace(/\[Konteks Sistem:[\s\S]*?\]/g, '')
  .trim();

const isDirectConversion = repliedMatch && cleanedRequest.length < 50 && 
  !cleanedRequest.toLowerCase().includes('tambah') && 
  !cleanedRequest.toLowerCase().includes('ubah') && 
  !cleanedRequest.toLowerCase().includes('ringkas');

console.log({
  repliedText: repliedMatch ? repliedMatch[1] : null,
  cleanedRequest,
  isDirectConversion,
});
