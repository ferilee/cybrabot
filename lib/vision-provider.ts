import 'dotenv/config';
import { GoogleGenAI, createPartFromBase64 } from '@google/genai';
import { formatTelegramRichText } from './telegram-rich';
import { buildVisionPrompt } from './vision-prompts';
import { detectVisionMode, type VisionMode } from './vision-router';

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'dummy_key',
});

const visionModel = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export type VisionTaskResult = {
  text: string;
  model: string;
  latencyMs: number;
  fallback: boolean;
  mode: VisionMode;
};

function stripModelReasoning(raw: string) {
  if (!raw) {
    return '';
  }

  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?thinking>/gi, ' ')
    .replace(/^\s*(thought|thinking|reasoning|analysis)\s*:\s*.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function createImagePartFromPath(filePath: string, mimeType: string) {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  return createPartFromBase64(base64, mimeType);
}

export async function runVisionTaskFromPath(input: {
  filePath: string;
  mimeType: string;
  prompt?: string;
  mode?: VisionMode;
  modelOverride?: string;
}) {
  if (!input.mimeType.startsWith('image/')) {
    throw new Error(`Vision provider hanya mendukung image/* untuk tahap ini. Diterima: ${input.mimeType}`);
  }

  const startedAt = Date.now();
  const mode = input.mode || detectVisionMode(input.prompt);
  const model = input.modelOverride?.trim() || visionModel;
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          await createImagePartFromPath(input.filePath, input.mimeType),
          {
            text: buildVisionPrompt(mode, input.prompt),
          },
        ],
      },
    ],
  });

  return {
    text: formatTelegramRichText(stripModelReasoning(response.text?.trim() || 'Gambar berhasil diproses, tetapi hasilnya kosong.')),
    model,
    latencyMs: Date.now() - startedAt,
    fallback: false,
    mode,
  } satisfies VisionTaskResult;
}
