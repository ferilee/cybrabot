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
