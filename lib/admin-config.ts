import { db } from '../db';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';

export type AdminConfig = {
  enabledTools: {
    math: boolean;
    caption: boolean;
    announcement: boolean;
    faq: boolean;
  };
  personaOverride: string;
  selfDescribe: {
    identity: string;
    features: string;
    workflow: string;
    improvement: string;
  };
};

export type AdminConfigInput = {
  enabledTools?: Partial<AdminConfig['enabledTools']>;
  personaOverride?: string;
  selfDescribe?: Partial<AdminConfig['selfDescribe']>;
};

const ADMIN_CONFIG_KEY = 'admin:config';

const defaultAdminConfig: AdminConfig = {
  enabledTools: {
    math: true,
    caption: true,
    announcement: true,
    faq: true,
  },
  personaOverride: '',
  selfDescribe: {
    identity:
      `<b>CybraFeriBot</b> adalah bot Telegram hybrid berbasis <b>Bun</b>, <b>Hono</b>, <b>SQLite</b>, dan <b>Gemini API</b>.\n\n` +
      `Bot ini dirancang untuk membantu chat umum, drafting ringan, ringkasan dokumen, tanya jawab berbasis file, dan pembuatan PDF/DOCX.\n\n` +
      `Kalau Kakak mau, saya juga bisa jelaskan <b>fitur</b>, <b>cara kerja</b>, atau <b>arah peningkatan</b> bot ini secara lebih spesifik.`,
    features:
      `<b>Fitur utama CybraFeriBot saat ini:</b>\n\n` +
      `- menjawab chat umum dan pertanyaan teknis ringan\n` +
      `- knowledge base lokal untuk FAQ/profil/informasi tertentu\n` +
      `- tool lokal seperti hitung, caption, dan pengumuman\n` +
      `- ringkas <b>PDF</b> atau <b>gambar</b>\n` +
      `- tanya jawab berdasarkan dokumen aktif\n` +
      `- membuat file <b>PDF</b> dan <b>DOCX</b>\n` +
      `- dashboard admin, telemetry, dan kontrol runtime`,
    workflow:
      `<b>Cara kerja CybraFeriBot secara ringkas:</b>\n\n` +
      `- menerima pesan dari Telegram lewat webhook\n` +
      `- menyimpan user dan riwayat chat ke SQLite\n` +
      `- merutekan permintaan ke tool lokal atau Gemini\n` +
      `- memakai knowledge base lokal bila relevan\n` +
      `- mencatat telemetry untuk evaluasi performa bot`,
    improvement:
      `<b>CybraFeriBot bisa ditingkatkan lewat jalur yang konkret, bukan sekadar "belajar sendiri".</b>\n\n` +
      `<b>Kemampuan yang sudah ada sekarang:</b>\n` +
      `- chat biasa dan jawaban teknis ringan\n` +
      `- knowledge base lokal\n` +
      `- tool lokal seperti hitung, caption, dan pengumuman\n` +
      `- ringkas <b>PDF/gambar</b> dan tanya jawab dokumen\n` +
      `- buat file <b>PDF</b> dan <b>DOCX</b>\n\n` +
      `<b>Kalau mau dibuat lebih kuat, prioritas peningkatannya biasanya:</b>\n` +
      `- tambah knowledge base yang lebih lengkap dan terkurasi\n` +
      `- tambah tool/action baru yang benar-benar menyelesaikan tugas\n` +
      `- perbaiki prompt dan routing intent\n` +
      `- tambah evaluasi dari log error, latency, dan pertanyaan user\n` +
      `- tambah template dokumen agar output PDF/DOCX lebih konsisten\n\n` +
      `Jadi peningkatannya datang dari <b>kode, prompt, knowledge, dan tool</b>, bukan dari interaksi acak saja.`,
  },
};

export async function getAdminConfig(): Promise<AdminConfig> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, ADMIN_CONFIG_KEY),
  });

  if (!row?.value) {
    return defaultAdminConfig;
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<AdminConfig>;
    return {
      enabledTools: {
        ...defaultAdminConfig.enabledTools,
        ...(parsed.enabledTools || {}),
      },
      personaOverride: parsed.personaOverride || '',
      selfDescribe: {
        ...defaultAdminConfig.selfDescribe,
        ...(parsed.selfDescribe || {}),
      },
    };
  } catch {
    return defaultAdminConfig;
  }
}

export async function saveAdminConfig(input: AdminConfigInput) {
  const existing = await getAdminConfig();
  const merged: AdminConfig = {
    enabledTools: {
      ...existing.enabledTools,
      ...(input.enabledTools || {}),
    },
    personaOverride: input.personaOverride ?? existing.personaOverride,
    selfDescribe: {
      ...existing.selfDescribe,
      ...(input.selfDescribe || {}),
    },
  };

  await db
    .insert(settings)
    .values({
      key: ADMIN_CONFIG_KEY,
      value: JSON.stringify(merged),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: JSON.stringify(merged),
      },
    });

  return merged;
}

export function isValidAdminToken(token: string | null | undefined) {
  const expected = process.env.ADMIN_TOKEN;
  return Boolean(expected) && token === expected;
}
