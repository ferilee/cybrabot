import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(), // Telegram User ID
  username: text('username'),
  firstName: text('first_name'),
  role: text('role').default('user'), // 'user', 'admin'
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
}));

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  content: text('content'),
  role: text('role'), // 'user', 'bot'
  intent: text('intent'), // 'technical', 'casual', 'admin'
  timestamp: integer('timestamp', { mode: 'timestamp' }).default(new Date()),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const telemetryEvents = sqliteTable('telemetry_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event: text('event').notNull(),
  level: text('level').notNull(),
  payload: text('payload'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
});

export const documentSessions = sqliteTable('document_sessions', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  title: text('title'),
  mimeType: text('mime_type').notNull(),
  sourceKind: text('source_kind').notNull().default('gemini'),
  localFilePath: text('local_file_path'),
  telegramFileId: text('telegram_file_id'),
  telegramFilePath: text('telegram_file_path'),
  geminiFileName: text('gemini_file_name'),
  geminiFileUri: text('gemini_file_uri'),
  extractedText: text('extracted_text'),
  summary: text('summary'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date()),
});

export const webUsers = sqliteTable('web_users', {
  email: text('email').primaryKey(),
  googleName: text('google_name'),
  picture: text('picture'),
  role: text('role').notNull().default('visitor'),
  fullName: text('full_name'),
  provinceId: text('province_id'),
  provinceName: text('province_name'),
  regencyId: text('regency_id'),
  regencyName: text('regency_name'),
  districtId: text('district_id'),
  districtName: text('district_name'),
  villageId: text('village_id'),
  villageName: text('village_name'),
  profileCompleted: integer('profile_completed', { mode: 'boolean' }).notNull().default(false),
  suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
  chatCount: integer('chat_count').notNull().default(0),
  quotaCycleStart: integer('quota_cycle_start', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
});

export const webChatLogs = sqliteTable('web_chat_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().references(() => webUsers.email),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  route: text('route'),
  skillId: text('skill_id'),
  intent: text('intent'),
  model: text('model'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
});

export const webGrillSessions = sqliteTable('web_grill_sessions', {
  sessionKey: text('session_key').primaryKey(),
  topic: text('topic').notNull(),
  material: text('material').notNull(),
  totalQuestions: integer('total_questions').notNull().default(3),
  timerSeconds: integer('timer_seconds'),
  currentQuestion: integer('current_question').notNull().default(0),
  currentQuestionText: text('current_question_text'),
  phase: text('phase').notNull().default('awaiting_ready'),
  hardMode: integer('hard_mode', { mode: 'boolean' }).notNull().default(false),
  difficultyLevel: integer('difficulty_level').notNull().default(1),
  focusHint: text('focus_hint'),
  answeredCount: integer('answered_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  partialCount: integer('partial_count').notNull().default(0),
  questionReviews: text('question_reviews'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date()),
});

export const webGrillSessionHistory = sqliteTable('web_grill_session_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionKey: text('session_key').notNull(),
  email: text('email').references(() => webUsers.email),
  topic: text('topic').notNull(),
  totalQuestions: integer('total_questions').notNull(),
  answeredCount: integer('answered_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  partialCount: integer('partial_count').notNull().default(0),
  timerSeconds: integer('timer_seconds'),
  hardMode: integer('hard_mode', { mode: 'boolean' }).notNull().default(false),
  difficultyLevel: integer('difficulty_level').notNull().default(1),
  focusHint: text('focus_hint'),
  endedReason: text('ended_reason').notNull().default('completed'),
  finalReview: text('final_review'),
  questionReviews: text('question_reviews'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' }).default(new Date()),
});
