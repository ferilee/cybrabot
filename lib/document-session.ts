import { db } from '../db';
import { documentSessions } from '../db/schema';
import { eq } from 'drizzle-orm';

export type ActiveDocumentSession = {
  userId: number;
  title: string;
  mimeType: string;
  telegramFileId?: string | null;
  telegramFilePath?: string | null;
  geminiFileName?: string | null;
  geminiFileUri?: string | null;
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
    telegramFileId: session.telegramFileId,
    telegramFilePath: session.telegramFilePath,
    geminiFileName: session.geminiFileName,
    geminiFileUri: session.geminiFileUri,
    summary: session.summary,
  };
}

export async function saveActiveDocumentSession(input: ActiveDocumentSession) {
  await db
    .insert(documentSessions)
    .values({
      userId: input.userId,
      title: input.title,
      mimeType: input.mimeType,
      telegramFileId: input.telegramFileId || null,
      telegramFilePath: input.telegramFilePath || null,
      geminiFileName: input.geminiFileName || null,
      geminiFileUri: input.geminiFileUri || null,
      summary: input.summary || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: documentSessions.userId,
      set: {
        title: input.title,
        mimeType: input.mimeType,
        telegramFileId: input.telegramFileId || null,
        telegramFilePath: input.telegramFilePath || null,
        geminiFileName: input.geminiFileName || null,
        geminiFileUri: input.geminiFileUri || null,
        summary: input.summary || null,
        updatedAt: new Date(),
      },
    });
}

export async function clearActiveDocumentSession(userId: number) {
  await db.delete(documentSessions).where(eq(documentSessions.userId, userId));
}
