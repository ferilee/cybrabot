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
    source_kind TEXT NOT NULL DEFAULT 'gemini',
    local_file_path TEXT,
    telegram_file_id TEXT,
    telegram_file_path TEXT,
    gemini_file_name TEXT,
    gemini_file_uri TEXT,
    extracted_text TEXT,
    summary TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS web_users (
    email TEXT PRIMARY KEY NOT NULL,
    google_name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'visitor',
    full_name TEXT,
    province_id TEXT,
    province_name TEXT,
    regency_id TEXT,
    regency_name TEXT,
    district_id TEXT,
    district_name TEXT,
    village_id TEXT,
    village_name TEXT,
    profile_completed INTEGER NOT NULL DEFAULT 0,
    suspended INTEGER NOT NULL DEFAULT 0,
    chat_count INTEGER NOT NULL DEFAULT 0,
    quota_cycle_start INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS web_chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    route TEXT,
    skill_id TEXT,
    intent TEXT,
    model TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (email) REFERENCES web_users(email)
  );

  CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);
  CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS telemetry_event_name_idx ON telemetry_events(event);
  CREATE INDEX IF NOT EXISTS telemetry_created_at_idx ON telemetry_events(created_at);
  CREATE INDEX IF NOT EXISTS document_sessions_updated_at_idx ON document_sessions(updated_at);
  CREATE INDEX IF NOT EXISTS web_users_role_idx ON web_users(role);
  CREATE INDEX IF NOT EXISTS web_users_profile_completed_idx ON web_users(profile_completed);
  CREATE INDEX IF NOT EXISTS web_users_last_login_at_idx ON web_users(last_login_at);
  CREATE INDEX IF NOT EXISTS web_chat_logs_email_idx ON web_chat_logs(email);
  CREATE INDEX IF NOT EXISTS web_chat_logs_created_at_idx ON web_chat_logs(created_at);
`);

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const columns = sqlite.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

ensureColumn('document_sessions', 'source_kind', "source_kind TEXT NOT NULL DEFAULT 'gemini'");
ensureColumn('document_sessions', 'local_file_path', 'local_file_path TEXT');
ensureColumn('document_sessions', 'extracted_text', 'extracted_text TEXT');
ensureColumn('web_users', 'google_name', 'google_name TEXT');
ensureColumn('web_users', 'picture', 'picture TEXT');
ensureColumn('web_users', 'role', "role TEXT NOT NULL DEFAULT 'visitor'");
ensureColumn('web_users', 'full_name', 'full_name TEXT');
ensureColumn('web_users', 'province_id', 'province_id TEXT');
ensureColumn('web_users', 'province_name', 'province_name TEXT');
ensureColumn('web_users', 'regency_id', 'regency_id TEXT');
ensureColumn('web_users', 'regency_name', 'regency_name TEXT');
ensureColumn('web_users', 'district_id', 'district_id TEXT');
ensureColumn('web_users', 'district_name', 'district_name TEXT');
ensureColumn('web_users', 'village_id', 'village_id TEXT');
ensureColumn('web_users', 'village_name', 'village_name TEXT');
ensureColumn('web_users', 'profile_completed', 'profile_completed INTEGER NOT NULL DEFAULT 0');
ensureColumn('web_users', 'suspended', 'suspended INTEGER NOT NULL DEFAULT 0');
ensureColumn('web_users', 'chat_count', 'chat_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('web_users', 'quota_cycle_start', 'quota_cycle_start INTEGER');
ensureColumn('web_users', 'updated_at', 'updated_at INTEGER DEFAULT (unixepoch())');
ensureColumn('web_users', 'last_login_at', 'last_login_at INTEGER');
ensureColumn('web_chat_logs', 'route', 'route TEXT');
ensureColumn('web_chat_logs', 'skill_id', 'skill_id TEXT');
ensureColumn('web_chat_logs', 'intent', 'intent TEXT');
ensureColumn('web_chat_logs', 'model', 'model TEXT');

sqlite.close();

console.log(`✅ Database initialized at ${databasePath}`);
