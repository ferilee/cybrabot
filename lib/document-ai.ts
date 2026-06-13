import 'dotenv/config';
import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { logEvent } from './observability';
import type { ActiveDocumentSession } from './document-session';

if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY/GOOGLE_API_KEY is missing! Document AI features will fail until you set it.');
}

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'dummy_key',
});

const documentModel = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export type DocumentSummaryResult = {
  summary: string;
  model: string;
  latencyMs: number;
  geminiFileName: string;
  geminiFileUri: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFileActive(fileName: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const file = await client.files.get({ name: fileName });
    if (file.state === 'ACTIVE' || !file.state) {
      return file;
    }
    if (file.state === 'FAILED') {
      throw new Error(file.error?.message || 'Gemini file processing failed');
    }
    await sleep(1500);
  }

  throw new Error('Gemini file processing timed out');
}

export async function summarizeDocumentFromPath(filePath: string, mimeType: string, displayName: string): Promise<DocumentSummaryResult> {
  const startedAt = Date.now();
  const uploaded = await client.files.upload({
    file: filePath,
    config: {
      mimeType,
      displayName,
    },
  });

  if (!uploaded.name) {
    throw new Error('Gemini file upload did not return a file name');
  }

  const readyFile = await waitForFileActive(uploaded.name);
  if (!readyFile.uri || !readyFile.mimeType) {
    throw new Error('Gemini file upload did not return a usable URI');
  }

  const response = await client.models.generateContent({
    model: documentModel,
    contents: [
      {
        role: 'user',
        parts: [
          createPartFromUri(readyFile.uri, readyFile.mimeType),
          {
            text:
              `Ringkas dokumen atau gambar ini dalam bahasa Indonesia.\n` +
              `Fokus pada:\n` +
              `1. topik utama\n` +
              `2. poin penting\n` +
              `3. data/fakta penting\n` +
              `4. kesimpulan atau tindak lanjut\n\n` +
              `Gunakan HTML sederhana yang aman untuk Telegram.`,
          },
        ],
      },
    ],
  });

  return {
    summary: response.text?.trim() || 'Dokumen berhasil diproses, tetapi ringkasan kosong.',
    model: documentModel,
    latencyMs: Date.now() - startedAt,
    geminiFileName: readyFile.name || uploaded.name,
    geminiFileUri: readyFile.uri,
  };
}

export async function answerQuestionAboutDocument(session: ActiveDocumentSession, question: string) {
  const startedAt = Date.now();

  if (!session.geminiFileUri) {
    throw new Error('Dokumen aktif tidak memiliki referensi file Gemini');
  }

  const response = await client.models.generateContent({
    model: documentModel,
    contents: [
      {
        role: 'user',
        parts: [
          createPartFromUri(session.geminiFileUri, session.mimeType),
          {
            text:
              `Jawab pertanyaan pengguna berdasarkan dokumen ini.\n` +
              `Jika jawabannya tidak ada di dokumen, katakan dengan jujur bahwa informasi itu tidak terlihat di dokumen.\n` +
              `Gunakan bahasa Indonesia yang jelas dan HTML sederhana yang aman untuk Telegram.\n\n` +
              `Pertanyaan pengguna: ${question}`,
          },
        ],
      },
    ],
  });

  return {
    text: response.text?.trim() || 'Saya belum bisa menemukan jawaban yang jelas dari dokumen itu.',
    model: documentModel,
    latencyMs: Date.now() - startedAt,
    fallback: false,
  };
}

export async function explainDocumentFeatureError(error: unknown, context: Record<string, unknown> = {}) {
  await logEvent('document.processing_error', {
    ...context,
    model: documentModel,
    error: String(error),
  }, 'error');
}
