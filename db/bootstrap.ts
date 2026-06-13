import 'dotenv/config';
import { Database } from 'bun:sqlite';

const databasePath = process.env.DATABASE_URL || 'sqlite.db';
const sqlite = new Database(databasePath, { create: true });

sqlite.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY NOT NULL,
    username TEXT,
    first_name TEXT,
    role TEXT DEFAULT 'user',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER,
    content TEXT,
    role TEXT,
    intent TEXT,
    timestamp INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    event TEXT NOT NULL,
    level TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS document_sessions (
    user_id INTEGER PRIMARY KEY NOT NULL,
    title TEXT,
    mime_type TEXT NOT NULL,
    telegram_file_id TEXT,
    telegram_file_path TEXT,
    gemini_file_name TEXT,
    gemini_file_uri TEXT,
    summary TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);
  CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS telemetry_event_name_idx ON telemetry_events(event);
  CREATE INDEX IF NOT EXISTS telemetry_created_at_idx ON telemetry_events(created_at);
  CREATE INDEX IF NOT EXISTS document_sessions_updated_at_idx ON document_sessions(updated_at);
`);

sqlite.close();

console.log(`✅ Database initialized at ${databasePath}`);
