import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { webUsers } from '../db/schema';
import type { WebSession } from './web-auth';

export const WEB_CHAT_QUOTA_LIMIT = 5;
export const WEB_CHAT_QUOTA_WINDOW_DAYS = 3;
const WINDOW_MS = WEB_CHAT_QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type WebQuotaStatus = {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string | null;
  cycleStartedAt: string | null;
  windowDays: number;
  suspended: boolean;
};

export async function syncWebUserAccount(session: WebSession) {
  const now = new Date();
  const email = session.email.trim().toLowerCase();
  const existing = await db.query.webUsers.findFirst({
    where: eq(webUsers.email, email),
  });

  if (!existing) {
    await db.insert(webUsers).values({
      email,
      googleName: session.name,
      picture: session.picture || null,
      role: session.role,
      quotaCycleStart: now,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  } else {
    await db.update(webUsers)
      .set({
        googleName: session.name,
        picture: session.picture || null,
        role: session.role,
        updatedAt: now,
        lastLoginAt: now,
      })
      .where(eq(webUsers.email, email));
  }

  return getWebUserByEmail(email);
}

export async function getWebUserByEmail(email: string) {
  return db.query.webUsers.findFirst({
    where: eq(webUsers.email, email.trim().toLowerCase()),
  });
}

function addQuotaWindow(start: Date, periods: number) {
  return new Date(start.getTime() + (periods * WINDOW_MS));
}

async function normalizeQuotaWindow(email: string) {
  const user = await getWebUserByEmail(email);
  if (!user) {
    return null;
  }

  const now = Date.now();
  const cycleStart = user.quotaCycleStart || user.createdAt || new Date();
  const elapsed = now - cycleStart.getTime();
  const periods = Math.floor(elapsed / WINDOW_MS);

  if (periods <= 0) {
    return user;
  }

  const nextCycleStart = addQuotaWindow(cycleStart, periods);
  await db.update(webUsers)
    .set({
      chatCount: 0,
      quotaCycleStart: nextCycleStart,
      updatedAt: new Date(),
    })
    .where(eq(webUsers.email, email));

  return getWebUserByEmail(email);
}

export function toWebQuotaStatus(user: typeof webUsers.$inferSelect | null): WebQuotaStatus {
  if (!user) {
    return {
      limit: WEB_CHAT_QUOTA_LIMIT,
      used: 0,
      remaining: WEB_CHAT_QUOTA_LIMIT,
      resetsAt: null,
      cycleStartedAt: null,
      windowDays: WEB_CHAT_QUOTA_WINDOW_DAYS,
      suspended: false,
    };
  }

  const cycleStart = user.quotaCycleStart || user.createdAt || null;
  const resetsAt = cycleStart ? addQuotaWindow(cycleStart, 1) : null;
  const used = Math.max(0, user.chatCount || 0);

  return {
    limit: WEB_CHAT_QUOTA_LIMIT,
    used,
    remaining: Math.max(0, WEB_CHAT_QUOTA_LIMIT - used),
    resetsAt: resetsAt?.toISOString() || null,
    cycleStartedAt: cycleStart?.toISOString() || null,
    windowDays: WEB_CHAT_QUOTA_WINDOW_DAYS,
    suspended: Boolean(user.suspended),
  };
}

export async function getWebQuotaStatus(email: string) {
  const normalized = await normalizeQuotaWindow(email.trim().toLowerCase());
  return toWebQuotaStatus(normalized ?? null);
}

export async function consumeWebChatQuota(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await normalizeQuotaWindow(normalizedEmail);
  if (!user) {
    return {
      ok: false as const,
      reason: 'user_not_found',
      quota: toWebQuotaStatus(null),
    };
  }

  const quota = toWebQuotaStatus(user);
  if (quota.suspended) {
    return {
      ok: false as const,
      reason: 'suspended',
      quota,
    };
  }

  if (quota.remaining <= 0) {
    return {
      ok: false as const,
      reason: 'limit_reached',
      quota,
    };
  }

  const updatedCount = (user.chatCount || 0) + 1;
  await db.update(webUsers)
    .set({
      chatCount: updatedCount,
      updatedAt: new Date(),
    })
    .where(eq(webUsers.email, normalizedEmail));

  const updated = await getWebUserByEmail(normalizedEmail);
  return {
    ok: true as const,
    reason: null,
    quota: toWebQuotaStatus(updated ?? user),
  };
}

export async function saveWebUserProfile(input: {
  email: string;
  fullName: string;
  provinceId: string;
  provinceName: string;
  regencyId: string;
  regencyName: string;
  districtId: string;
  districtName: string;
  villageId: string;
  villageName: string;
}) {
  const now = new Date();
  await db.update(webUsers)
    .set({
      fullName: input.fullName.trim(),
      provinceId: input.provinceId,
      provinceName: input.provinceName,
      regencyId: input.regencyId,
      regencyName: input.regencyName,
      districtId: input.districtId,
      districtName: input.districtName,
      villageId: input.villageId,
      villageName: input.villageName,
      profileCompleted: true,
      quotaCycleStart: now,
      chatCount: 0,
      updatedAt: now,
    })
    .where(eq(webUsers.email, input.email.trim().toLowerCase()));

  return getWebUserByEmail(input.email);
}

export async function listManagedWebUsers() {
  const rows = await db.query.webUsers.findMany({
    orderBy: [desc(webUsers.lastLoginAt), desc(webUsers.updatedAt), desc(webUsers.createdAt)],
  });

  return rows.map((row) => ({
    email: row.email,
    googleName: row.googleName,
    fullName: row.fullName,
    role: row.role,
    picture: row.picture,
    profileCompleted: Boolean(row.profileCompleted),
    suspended: Boolean(row.suspended),
    region: [row.villageName, row.districtName, row.regencyName, row.provinceName].filter(Boolean).join(', '),
    createdAt: row.createdAt?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toISOString?.() || null,
    lastLoginAt: row.lastLoginAt?.toISOString?.() || null,
    quota: toWebQuotaStatus(row),
  }));
}

export async function updateManagedWebUser(email: string, input: {
  suspended?: boolean;
  resetQuota?: boolean;
}) {
  const current = await getWebUserByEmail(email);
  if (!current) {
    return null;
  }

  const nextState: Partial<typeof webUsers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof input.suspended === 'boolean') {
    nextState.suspended = input.suspended;
  }

  if (input.resetQuota) {
    nextState.chatCount = 0;
    nextState.quotaCycleStart = new Date();
  }

  await db.update(webUsers)
    .set(nextState)
    .where(eq(webUsers.email, email.trim().toLowerCase()));

  return getWebUserByEmail(email);
}

export function isWebProfileComplete(user: typeof webUsers.$inferSelect | null | undefined) {
  return Boolean(
    user &&
    user.profileCompleted &&
    user.fullName &&
    user.provinceId &&
    user.regencyId &&
    user.districtId &&
    user.villageId
  );
}

export async function seedWebUserForTest(input: {
  email: string;
  role?: string;
  googleName?: string;
  fullName?: string;
  profileCompleted?: boolean;
  suspended?: boolean;
  chatCount?: number;
  quotaCycleStart?: Date;
}) {
  const now = new Date();
  await db.insert(webUsers).values({
    email: input.email.trim().toLowerCase(),
    role: input.role || 'visitor',
    googleName: input.googleName || input.email,
    fullName: input.fullName || null,
    profileCompleted: Boolean(input.profileCompleted),
    suspended: Boolean(input.suspended),
    chatCount: input.chatCount || 0,
    quotaCycleStart: input.quotaCycleStart || now,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  }).onConflictDoUpdate({
    target: webUsers.email,
    set: {
      role: input.role || 'visitor',
      googleName: input.googleName || input.email,
      fullName: input.fullName || null,
      profileCompleted: Boolean(input.profileCompleted),
      suspended: Boolean(input.suspended),
      chatCount: input.chatCount || 0,
      quotaCycleStart: input.quotaCycleStart || now,
      updatedAt: now,
      lastLoginAt: now,
    },
  });
}
