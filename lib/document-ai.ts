import 'dotenv/config';
import { GoogleGenAI, createPartFromBase64, createPartFromUri } from '@google/genai';
import OpenAI from 'openai';
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

const openAIBaseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_COMPAT_BASE_URL || 'https://api.tokenrouter.com/v1';
const openAIApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || process.env.TOKENROUTER_API_KEY || '';
const openAIClient = openAIApiKey
  ? new OpenAI({
      apiKey: openAIApiKey,
      baseURL: openAIBaseURL,
    })
  : null;

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

function stripModelReasoning(raw: string) {
  if (!raw) {
    return '';
  }

  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?thinking>/gi, ' ')
    .replace(/^\s*<\|assistant\|>\s*/gi, '')
    .replace(/^\s*(thought|thinking|reasoning|analysis)\s*:\s*.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

function parseModelSpec(spec?: string) {
  const trimmed = spec?.trim() || '';
  if (!trimmed) {
    return { provider: 'gemini' as const, model: documentModel };
  }

  const separatorIndex = trimmed.indexOf(':');
  if (separatorIndex <= 0) {
    return { provider: 'gemini' as const, model: trimmed };
  }

  const provider = trimmed.slice(0, separatorIndex).toLowerCase();
  const model = trimmed.slice(separatorIndex + 1).trim();

  if (!model) {
    return { provider: 'gemini' as const, model: trimmed };
  }

  if (provider === 'gemini') {
    return { provider: 'gemini' as const, model };
  }

  if (provider === 'tokenrouter' || provider === 'openai' || provider === 'openai-compatible') {
    return { provider: 'tokenrouter' as const, model };
  }

  return { provider: 'gemini' as const, model: trimmed };
}

async function generateTextWithModelSpec(modelSpec: string | undefined, instructions: string, input: string) {
  const startedAt = Date.now();
  const parsed = parseModelSpec(modelSpec);

  if (parsed.provider === 'tokenrouter') {
    if (!openAIClient) {
      throw new Error('OPENAI_API_KEY atau TOKENROUTER_API_KEY belum diisi untuk model OpenAI-compatible');
    }

    const response = await openAIClient.chat.completions.create({
      model: parsed.model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
    });

    return {
      text: stripModelReasoning(response.choices[0]?.message?.content?.trim() || ''),
      latencyMs: Date.now() - startedAt,
      model: modelSpec?.trim() || `${parsed.provider}:${parsed.model}`,
    };
  }

  const response = await client.models.generateContent({
    model: parsed.model,
    contents: input,
    config: {
      systemInstruction: instructions,
    },
  });

  return {
    text: stripModelReasoning(response.text?.trim() || ''),
    latencyMs: Date.now() - startedAt,
    model: modelSpec?.trim() || parsed.model,
  };
}

function resolveVisionModel(modelSpec?: string) {
  const parsed = parseModelSpec(modelSpec);
  if (parsed.provider === 'gemini') {
    return parsed.model;
  }

  return documentModel;
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
  modelOverride?: string,
): Promise<DocumentSummaryResult> {
  const startedAt = Date.now();

  if (isTextDocumentMimeType(mimeType)) {
    const extractedText = await extractTextFromDocument(filePath, mimeType);
    const response = await generateTextWithModelSpec(
      modelOverride,
      `Anda adalah @CybraFeriBot, asisten yang menyiapkan isi dokumen untuk diekspor menjadi PDF atau DOCX.\n` +
      `Buat isi dokumen dalam bahasa Indonesia yang rapi, natural, dan langsung siap diekspor.\n` +
      `Gunakan format plain text terstruktur dengan aturan berikut:\n` +
      `- Baris judul utama diawali "# "\n` +
      `- Subjudul diawali "## "\n` +
      `- Poin bullet diawali "- "\n` +
      `- Paragraf biasa tanpa markup lain\n` +
      `- Jangan gunakan markdown selain pola di atas\n` +
      `- Jangan gunakan tabel\n` +
      `- Jangan sertakan penjelasan pembuka seperti "berikut adalah"\n` +
      `- Jangan tampilkan catatan analisis internal atau reasoning model`,
      buildPromptForTextDocument(extractedText, prompt),
    );

    return {
      summary: formatTelegramRichText(response.text?.trim() || 'Dokumen berhasil dibaca, tetapi ringkasan kosong.'),
      model: response.model,
      latencyMs: Date.now() - startedAt,
      geminiFileName: '',
      geminiFileUri: '',
      sourceKind: 'text',
      extractedText,
    };
  }

  if (mimeType.startsWith('image/')) {
    const visionModel = resolveVisionModel(modelOverride);
    const response = await client.models.generateContent({
      model: visionModel,
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
      model: visionModel,
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
    model: resolveVisionModel(modelOverride),
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
    model: resolveVisionModel(modelOverride),
    latencyMs: Date.now() - startedAt,
    geminiFileName: readyFile.name || uploaded.name,
    geminiFileUri: readyFile.uri,
    sourceKind: 'gemini',
  };
}

export async function answerQuestionAboutDocument(
  session: ActiveDocumentSession,
  question: string,
  modelOverride?: string,
) {
  const startedAt = Date.now();

  if (session.sourceKind === 'text') {
    const documentText = session.extractedText?.trim();
    if (!documentText) {
      throw new Error('Dokumen teks aktif tidak memiliki isi yang bisa dibaca');
    }

    const response = await generateTextWithModelSpec(
      modelOverride,
      `Anda adalah @CybraFeriBot, asisten yang menjawab pertanyaan berdasarkan isi dokumen.\n` +
      `Kalau jawaban tidak ada di dalam dokumen, katakan dengan jujur bahwa informasi itu tidak terlihat di dokumen.\n` +
      `Jika diminta menghitung atau menyelesaikan soal, berikan langkah dan jawaban akhirnya.\n` +
      `Gunakan struktur plain text yang rapi dengan heading "# ", bullet "- ", kutipan "> ", atau code fence jika perlu.`,
      `Isi dokumen:\n${documentText}\n\nPertanyaan pengguna: ${question}`,
    );

    return {
      text: formatTelegramRichText(response.text?.trim() || 'Saya belum bisa menemukan jawaban yang jelas dari dokumen itu.'),
      model: response.model,
      latencyMs: Date.now() - startedAt,
      fallback: false,
    };
  }

  if (session.sourceKind === 'image') {
    if (!session.localFilePath) {
      throw new Error('Dokumen gambar aktif tidak memiliki file lokal');
    }

    const visionModel = resolveVisionModel(modelOverride);
    const response = await client.models.generateContent({
      model: visionModel,
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
      model: visionModel,
      latencyMs: Date.now() - startedAt,
      fallback: false,
    };
  }

  const visionModel = resolveVisionModel(modelOverride);
  if (!session.geminiFileUri) {
    throw new Error('Dokumen aktif tidak memiliki referensi file Gemini');
  }

  const response = await client.models.generateContent({
    model: visionModel,
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
    model: visionModel,
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
