import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { webGrillSessionHistory, webGrillSessions } from '../db/schema';

export type PersistedGrillSession = typeof webGrillSessions.$inferSelect;
export type PersistedGrillSessionInput = Omit<typeof webGrillSessions.$inferInsert, 'createdAt' | 'updatedAt'>;
export type PersistedGrillHistory = typeof webGrillSessionHistory.$inferSelect;

export async function getPersistedGrillSession(sessionKey: string) {
  return db.query.webGrillSessions.findFirst({
    where: eq(webGrillSessions.sessionKey, sessionKey),
  });
}

export async function savePersistedGrillSession(input: PersistedGrillSessionInput) {
  const now = new Date();
  await db.insert(webGrillSessions).values({
    ...input,
    updatedAt: now,
    createdAt: now,
  }).onConflictDoUpdate({
    target: webGrillSessions.sessionKey,
    set: {
      topic: input.topic,
      material: input.material,
      totalQuestions: input.totalQuestions,
      timerSeconds: input.timerSeconds ?? null,
      currentQuestion: input.currentQuestion,
      currentQuestionText: input.currentQuestionText ?? null,
      phase: input.phase,
      hardMode: Boolean(input.hardMode),
      difficultyLevel: input.difficultyLevel,
      focusHint: input.focusHint ?? null,
      answeredCount: input.answeredCount,
      correctCount: input.correctCount,
      partialCount: input.partialCount,
      questionReviews: input.questionReviews ?? null,
      updatedAt: now,
    },
  });
}

export async function deletePersistedGrillSession(sessionKey: string) {
  await db.delete(webGrillSessions).where(eq(webGrillSessions.sessionKey, sessionKey));
}

export async function archivePersistedGrillSession(input: {
  sessionKey: string;
  email?: string | null;
  topic: string;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  partialCount: number;
  timerSeconds: number | null;
  hardMode: boolean;
  difficultyLevel: number;
  focusHint?: string | null;
  endedReason: 'completed' | 'ended_by_user';
  finalReview?: string | null;
  questionReviews?: string | null;
  createdAt?: Date | null;
}) {
  await db.insert(webGrillSessionHistory).values({
    sessionKey: input.sessionKey,
    email: input.email || null,
    topic: input.topic,
    totalQuestions: input.totalQuestions,
    answeredCount: input.answeredCount,
    correctCount: input.correctCount,
    partialCount: input.partialCount,
    timerSeconds: input.timerSeconds,
    hardMode: input.hardMode,
    difficultyLevel: input.difficultyLevel,
    focusHint: input.focusHint ?? null,
    endedReason: input.endedReason,
    finalReview: input.finalReview || null,
    questionReviews: input.questionReviews || null,
    createdAt: input.createdAt || new Date(),
    completedAt: new Date(),
  });
}

export async function listPersistedGrillHistoryByEmail(email: string, limit = 12) {
  return db.query.webGrillSessionHistory.findMany({
    where: eq(webGrillSessionHistory.email, email.trim().toLowerCase()),
    orderBy: [desc(webGrillSessionHistory.completedAt), desc(webGrillSessionHistory.id)],
    limit,
  });
}
