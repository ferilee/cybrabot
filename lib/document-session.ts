import { db } from '../db';
import { documentSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { rmSync } from 'fs';

export type ActiveDocumentSession = {
  userId: number;
  title: string;
  mimeType: string;
  sourceKind: 'gemini' | 'text';
  localFilePath?: string | null;
  telegramFileId?: string | null;
  telegramFilePath?: string | null;
  geminiFileName?: string | null;
  geminiFileUri?: string | null;
  extractedText?: string | null;
  summary?: string | null;
};

export async function getActiveDocumentSession(userId: number): Promise<ActiveDocumentSession | null> {
  const session = await db.query.documentSessions.findFirst({
    where: eq(documentSessions.userId, userId),
  });

  if (!session) {
    return null;
  }

  return {
    userId: session.userId,
    title: session.title || 'Dokumen tanpa judul',
    mimeType: session.mimeType,
    sourceKind: session.sourceKind === 'text' ? 'text' : 'gemini',
    localFilePath: session.localFilePath,
    telegramFileId: session.telegramFileId,
    telegramFilePath: session.telegramFilePath,
    geminiFileName: session.geminiFileName,
    geminiFileUri: session.geminiFileUri,
    extractedText: session.extractedText,
    summary: session.summary,
  };
}

export async function saveActiveDocumentSession(input: ActiveDocumentSession) {
  const existing = await getActiveDocumentSession(input.userId);
  if (existing?.localFilePath && existing.localFilePath !== input.localFilePath) {
    rmSync(existing.localFilePath, { force: true });
  }

  await db
    .insert(documentSessions)
    .values({
      userId: input.userId,
      title: input.title,
      mimeType: input.mimeType,
      sourceKind: input.sourceKind,
      localFilePath: input.localFilePath || null,
      telegramFileId: input.telegramFileId || null,
      telegramFilePath: input.telegramFilePath || null,
      geminiFileName: input.geminiFileName || null,
      geminiFileUri: input.geminiFileUri || null,
      extractedText: input.extractedText || null,
      summary: input.summary || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: documentSessions.userId,
      set: {
        title: input.title,
        mimeType: input.mimeType,
        sourceKind: input.sourceKind,
        localFilePath: input.localFilePath || null,
        telegramFileId: input.telegramFileId || null,
        telegramFilePath: input.telegramFilePath || null,
        geminiFileName: input.geminiFileName || null,
        geminiFileUri: input.geminiFileUri || null,
        extractedText: input.extractedText || null,
        summary: input.summary || null,
        updatedAt: new Date(),
      },
    });
}

export async function clearActiveDocumentSession(userId: number) {
  const existing = await getActiveDocumentSession(userId);
  if (existing?.localFilePath) {
    rmSync(existing.localFilePath, { force: true });
  }

  await db.delete(documentSessions).where(eq(documentSessions.userId, userId));
}
