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

  CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);
  CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages(timestamp);
`);

sqlite.close();

console.log(`✅ Database initialized at ${databasePath}`);
