import { db } from '../db';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';

export type UserPreferences = {
  tone?: 'formal' | 'santai';
  answerLength?: 'ringkas' | 'normal' | 'detail';
  preferredName?: string;
};

function settingKey(userId: number) {
  return `user:${userId}:preferences`;
}

export async function getUserPreferences(userId: number): Promise<UserPreferences> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, settingKey(userId)),
  });

  if (!row?.value) {
    return {};
  }

  try {
    return JSON.parse(row.value) as UserPreferences;
  } catch {
    return {};
  }
}

export async function saveUserPreferences(userId: number, preferences: UserPreferences) {
  const key = settingKey(userId);
  const existing = await getUserPreferences(userId);
  const merged = { ...existing, ...preferences };

  await db
    .insert(settings)
    .values({
      key,
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

export function detectPreferenceUpdate(text: string): UserPreferences | null {
  const lower = text.toLowerCase();
  const update: UserPreferences = {};

  if (lower.includes('bahasa formal') || lower.includes('lebih formal') || lower.includes('gaya formal')) {
    update.tone = 'formal';
  } else if (lower.includes('bahasa santai') || lower.includes('lebih santai') || lower.includes('gaya santai')) {
    update.tone = 'santai';
  }

  if (lower.includes('jawaban ringkas') || lower.includes('singkat saja') || lower.includes('lebih singkat')) {
    update.answerLength = 'ringkas';
  } else if (lower.includes('jawaban detail') || lower.includes('lebih detail') || lower.includes('jelaskan detail')) {
    update.answerLength = 'detail';
  } else if (lower.includes('jawaban normal')) {
    update.answerLength = 'normal';
  }

  const preferredNameMatch = text.match(
    /panggil aku\s+([A-Za-z0-9 ._-]{2,40}?)(?:\s+(?:dan|dengan|pakai|gunakan|jawaban|bahasa|lebih)\b|$)/i
  );
  if (preferredNameMatch?.[1]) {
    update.preferredName = preferredNameMatch[1].trim();
  }

  return Object.keys(update).length ? update : null;
}

export function formatPreferenceInstruction(preferences: UserPreferences) {
  const instructions: string[] = [];

  if (preferences.preferredName) {
    instructions.push(`Panggil pengguna dengan nama "${preferences.preferredName}".`);
  }

  if (preferences.tone === 'formal') {
    instructions.push('Gunakan gaya bahasa yang lebih formal dan rapi.');
  } else if (preferences.tone === 'santai') {
    instructions.push('Gunakan gaya bahasa santai yang tetap sopan.');
  }

  if (preferences.answerLength === 'ringkas') {
    instructions.push('Utamakan jawaban singkat dan langsung ke inti.');
  } else if (preferences.answerLength === 'detail') {
    instructions.push('Berikan jawaban yang lebih detail dan terstruktur.');
  }

  return instructions.length ? `${instructions.join(' ')}\n` : '';
}

export function formatPreferenceConfirmation(preferences: UserPreferences) {
  const items: string[] = [];

  if (preferences.preferredName) {
    items.push(`sapaan: <b>${preferences.preferredName}</b>`);
  }
  if (preferences.tone) {
    items.push(`gaya bahasa: <b>${preferences.tone}</b>`);
  }
  if (preferences.answerLength) {
    items.push(`panjang jawaban: <b>${preferences.answerLength}</b>`);
  }

  return items.length
    ? `Siap, preferensi Kakak saya simpan: ${items.join(', ')}.`
    : 'Siap, preferensi Kakak sudah saya simpan.';
}
