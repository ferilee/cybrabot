import 'dotenv/config';
import { GoogleGenAI, createPartFromBase64, createPartFromUri } from '@google/genai';
import { logEvent } from './observability';
import type { ActiveDocumentSession } from './document-session';
import { extractTextFromDocument, isTextDocumentMimeType } from './document-source';
import { formatTelegramRichText } from './telegram-rich';

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
  sourceKind: 'gemini' | 'text' | 'image';
  extractedText?: string;
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

function buildPromptForDocument(prompt?: string) {
  const trimmedPrompt = prompt?.trim();

  if (trimmedPrompt) {
    return (
      `Ikuti permintaan pengguna berikut berdasarkan isi dokumen.\n` +
      `Jika perlu, jelaskan langkah per langkah dan tampilkan hasil akhir yang bisa langsung dipakai.\n` +
      `Gunakan bahasa Indonesia yang jelas, ringkas, dan mudah dibaca.\n\n` +
      `Permintaan pengguna: ${trimmedPrompt}`
    );
  }

  return (
    `Baca dokumen atau gambar ini dan buat ringkasan dalam bahasa Indonesia.\n` +
    `Fokus pada:\n` +
    `1. topik utama\n` +
    `2. poin penting\n` +
    `3. data/fakta penting\n` +
    `4. kesimpulan atau tindak lanjut\n\n` +
    `Gunakan struktur plain text yang rapi dengan heading "# ", subheading "## ", bullet "- ", dan kutipan "> ".`
  );
}

function buildPromptForImageDocument(prompt?: string) {
  const trimmedPrompt = prompt?.trim();

  if (trimmedPrompt) {
    return (
      `Jawab permintaan pengguna berdasarkan isi gambar ini.\n` +
      `Jika gambar berisi soal matematika, baca semua ekspresi dan kerjakan langkah demi langkah.\n` +
      `Jika gambar berisi teks, tabel, atau catatan, jelaskan isi yang terlihat dan jawab permintaan pengguna dengan tepat.\n` +
      `Kalau ada bagian yang tidak terbaca, sebutkan bagian itu dengan jujur.\n\n` +
      `Permintaan pengguna: ${trimmedPrompt}`
    );
  }

  return (
    `Baca gambar ini dan buat ringkasan dalam bahasa Indonesia.\n` +
    `Fokus pada teks yang terlihat, data penting, dan kesimpulan yang bisa diambil.\n` +
    `Jika gambar berisi soal, tampilkan langkah penyelesaian dan jawaban akhirnya.\n`
  );
}

function buildPromptForTextDocument(documentText: string, prompt?: string) {
  const trimmedPrompt = prompt?.trim();

  if (trimmedPrompt) {
    return (
      `Jawab permintaan pengguna berikut berdasarkan isi dokumen di bawah.\n` +
      `Kalau dokumen berisi tabel, angka, atau soal, kerjakan dengan teliti.\n` +
      `Jika jawabannya tidak terlihat, katakan dengan jujur.\n\n` +
      `Permintaan pengguna: ${trimmedPrompt}\n\n` +
      `Isi dokumen:\n${documentText}`
    );
  }

  return (
    `Baca dokumen di bawah lalu ringkas dalam bahasa Indonesia.\n` +
    `Fokus pada:\n` +
    `1. topik utama\n` +
    `2. poin penting\n` +
    `3. data/fakta penting\n` +
    `4. kesimpulan atau tindak lanjut\n\n` +
    `Isi dokumen:\n${documentText}`
  );
}

async function createImagePartFromPath(filePath: string, mimeType: string) {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  return createPartFromBase64(base64, mimeType);
}

export async function summarizeDocumentFromPath(
  filePath: string,
  mimeType: string,
  displayName: string,
  prompt?: string,
): Promise<DocumentSummaryResult> {
  const startedAt = Date.now();

  if (isTextDocumentMimeType(mimeType)) {
    const extractedText = await extractTextFromDocument(filePath, mimeType);
    const response = await client.models.generateContent({
      model: documentModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildPromptForTextDocument(extractedText, prompt),
            },
          ],
        },
      ],
    });

    return {
      summary: formatTelegramRichText(response.text?.trim() || 'Dokumen berhasil dibaca, tetapi ringkasan kosong.'),
      model: documentModel,
      latencyMs: Date.now() - startedAt,
      geminiFileName: '',
      geminiFileUri: '',
      sourceKind: 'text',
      extractedText,
    };
  }

  if (mimeType.startsWith('image/')) {
    const response = await client.models.generateContent({
      model: documentModel,
      contents: [
        {
          role: 'user',
          parts: [
            await createImagePartFromPath(filePath, mimeType),
            {
              text: buildPromptForImageDocument(prompt),
            },
          ],
        },
      ],
    });

    return {
      summary: formatTelegramRichText(response.text?.trim() || 'Gambar berhasil diproses, tetapi ringkasan kosong.'),
      model: documentModel,
      latencyMs: Date.now() - startedAt,
      geminiFileName: '',
      geminiFileUri: '',
      sourceKind: 'image',
    };
  }

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
            text: buildPromptForDocument(prompt),
          },
        ],
      },
    ],
  });

  return {
    summary: formatTelegramRichText(response.text?.trim() || 'Dokumen berhasil diproses, tetapi ringkasan kosong.'),
    model: documentModel,
    latencyMs: Date.now() - startedAt,
    geminiFileName: readyFile.name || uploaded.name,
    geminiFileUri: readyFile.uri,
    sourceKind: 'gemini',
  };
}

export async function answerQuestionAboutDocument(session: ActiveDocumentSession, question: string) {
  const startedAt = Date.now();

  if (session.sourceKind === 'text') {
    const documentText = session.extractedText?.trim();
    if (!documentText) {
      throw new Error('Dokumen teks aktif tidak memiliki isi yang bisa dibaca');
    }

    const response = await client.models.generateContent({
      model: documentModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Jawab pertanyaan pengguna berdasarkan isi dokumen berikut.\n` +
                `Kalau jawaban tidak ada di dalam dokumen, katakan dengan jujur bahwa informasi itu tidak terlihat di dokumen.\n` +
                `Jika diminta menghitung atau menyelesaikan soal, berikan langkah dan jawaban akhirnya.\n\n` +
                `Isi dokumen:\n${documentText}\n\n` +
                `Pertanyaan pengguna: ${question}`,
            },
          ],
        },
      ],
    });

    return {
      text: formatTelegramRichText(response.text?.trim() || 'Saya belum bisa menemukan jawaban yang jelas dari dokumen itu.'),
      model: documentModel,
      latencyMs: Date.now() - startedAt,
      fallback: false,
    };
  }

  if (session.sourceKind === 'image') {
    if (!session.localFilePath) {
      throw new Error('Dokumen gambar aktif tidak memiliki file lokal');
    }

    const response = await client.models.generateContent({
      model: documentModel,
      contents: [
        {
          role: 'user',
          parts: [
            await createImagePartFromPath(session.localFilePath, session.mimeType),
            {
              text:
                `Jawab pertanyaan pengguna berdasarkan gambar ini.\n` +
                `Jika gambar berisi soal matematika, selesaikan dengan langkah yang benar dan beri jawaban final.\n` +
                `Jika gambar berisi teks atau tabel, baca isinya dengan teliti dan jawab berdasarkan apa yang terlihat.\n` +
                `Kalau jawaban tidak terlihat, katakan dengan jujur bahwa informasi itu tidak terbaca di gambar.\n\n` +
                `Pertanyaan pengguna: ${question}`,
            },
          ],
        },
      ],
    });

    return {
      text: formatTelegramRichText(response.text?.trim() || 'Saya belum bisa menemukan jawaban yang jelas dari gambar itu.'),
      model: documentModel,
      latencyMs: Date.now() - startedAt,
      fallback: false,
    };
  }

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
              `Jika diminta menghitung atau menyelesaikan soal dari PDF/gambar, kerjakan dengan langkah yang benar dan beri jawaban final.\n` +
              `Gunakan struktur plain text yang rapi dengan heading "# ", bullet "- ", kutipan "> ", atau code fence jika perlu.\n\n` +
              `Pertanyaan pengguna: ${question}`,
          },
        ],
      },
    ],
  });

  return {
    text: formatTelegramRichText(response.text?.trim() || 'Saya belum bisa menemukan jawaban yang jelas dari dokumen itu.'),
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
