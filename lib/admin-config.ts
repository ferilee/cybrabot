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
    };
  } catch {
    return defaultAdminConfig;
  }
}

export async function saveAdminConfig(input: Partial<AdminConfig>) {
  const existing = await getAdminConfig();
  const merged: AdminConfig = {
    enabledTools: {
      ...existing.enabledTools,
      ...(input.enabledTools || {}),
    },
    personaOverride: input.personaOverride ?? existing.personaOverride,
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
