import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { logEvent } from './observability';
import { formatTelegramRichCardWithBody, formatTelegramRichText } from './telegram-rich';

const execAsync = promisify(exec);
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'dummy_key',
});
const agentModel = process.env.GEMINI_AGENT_MODEL || 'gemini-2.5-flash';

// Tool 1: execute_bash
async function executeBash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 15000 });
    let result = stdout;
    if (stderr) result += `\n[STDERR]\n${stderr}`;
    return result || 'Command executed successfully with no output.';
  } catch (error: any) {
    return `Error executing command:\n${error.message}\nSTDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`;
  }
}

// Tool 2: read_file
async function readFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.slice(0, 10000); // Limit output to prevent context window overflow
  } catch (error: any) {
    return `Error reading file: ${error.message}`;
  }
}

// Tool 3: search_web (using a simple DuckDuckGo HTML scraper for demo purposes, or fallback to returning instructions)
async function searchWeb(query: string): Promise<string> {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    // Simple naive extraction of text from result snippets
    const snippetMatches = html.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi);
    if (!snippetMatches) return "No results found or blocked by search engine.";
    
    const results = snippetMatches
      .slice(0, 5)
      .map(s => s.replace(/<[^>]+>/g, '').trim())
      .join('\n\n');
    return results || "No results found.";
  } catch (error: any) {
    return `Error searching web: ${error.message}`;
  }
}

const functionDeclarations = [
  {
    name: 'execute_bash',
    description: 'Execute a bash command on the host terminal. WARNING: Modifying system files can be dangerous.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The bash command to execute.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file on the file system.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: 'The absolute or relative path to the file.',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the internet for a given query to get real-time information.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query.',
        },
      },
      required: ['query'],
    },
  }
];

export async function runAgentLoop(prompt: string, updateStatus?: (msg: string) => void): Promise<{ text: string, html: string }> {
  try {
    const chat = client.chats.create({
      model: agentModel,
      config: {
        systemInstruction: `Kamu adalah Dianyssa dalam mode "Autonomous Agent". 
Kamu memiliki akses ke terminal (execute_bash), file system (read_file), dan internet (search_web).
Kamu harus menyelesaikan permintaan user secara mandiri.
Gunakan tools yang tersedia untuk mengumpulkan informasi atau menjalankan aksi.
Selalu berpikir langkah demi langkah.
Berikan jawaban akhir yang sangat jelas dan terstruktur dengan Markdown.`,
        tools: [{ functionDeclarations: functionDeclarations as any }],
      },
    });

    let currentPrompt = prompt;
    let turnCount = 0;
    const maxTurns = 5;

    while (turnCount < maxTurns) {
      if (updateStatus) {
        updateStatus(turnCount === 0 ? 'Menganalisis permintaan...' : 'Berpikir...');
      }
      
      const response = await chat.sendMessage({ message: currentPrompt });
      
      if (response.functionCalls && response.functionCalls.length > 0) {
        const call = response.functionCalls[0] as any;
        const functionName = call.name;
        const args = call.args as Record<string, any>;
        
        let toolResult = '';
        
        if (functionName === 'execute_bash') {
          if (updateStatus) updateStatus(`Menjalankan bash: ${args.command}`);
          toolResult = await executeBash(args.command);
        } else if (functionName === 'read_file') {
          if (updateStatus) updateStatus(`Membaca file: ${args.file_path}`);
          toolResult = await readFile(args.file_path);
        } else if (functionName === 'search_web') {
          if (updateStatus) updateStatus(`Mencari di web: ${args.query}`);
          toolResult = await searchWeb(args.query);
        }

        // Send tool result back to model
        currentPrompt = `Tool ${functionName} returned:\n${toolResult}`;
        turnCount++;
      } else {
        // No function call, we have a final answer
        const textResponse = response.text || "Tidak ada jawaban dari agent.";
        return {
          text: textResponse,
          html: formatTelegramRichCardWithBody({
            title: 'Agent Dianyssa',
            subtitle: 'Autonomous Mode',
            badge: 'ROOT',
            fields: [
              { label: 'Model', value: agentModel },
              { label: 'Turns', value: `${turnCount + 1}` },
            ],
            bodyHtml: formatTelegramRichText(textResponse),
          }),
        };
      }
    }

    return {
      text: "Agent mencapai batas maksimal langkah.",
      html: "Agent mencapai batas maksimal langkah sebelum menemukan jawaban akhir."
    };
  } catch (error: any) {
    await logEvent('agent.error', { error: error.message }, 'error');
    throw error;
  }
}
