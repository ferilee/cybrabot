import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const tempRoot = String((globalThis as Record<string, unknown>).__CYBRA_TEST_TEMP_ROOT || '');
export const testDbPath = String((globalThis as Record<string, unknown>).__CYBRA_TEST_DB_PATH || process.env.DATABASE_URL || '');
export const testKnowledgeDir = String((globalThis as Record<string, unknown>).__CYBRA_TEST_KNOWLEDGE_DIR || process.env.KNOWLEDGE_DIR || '');
export const testArtifactsDir = join(tempRoot, 'artifacts');

mkdirSync(testArtifactsDir, { recursive: true });

export function resetDatabase() {
  const sqlite = new Database(testDbPath, { create: true });
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  sqlite.exec(`
    DELETE FROM web_chat_logs;
    DELETE FROM web_users;
    DELETE FROM document_sessions;
    DELETE FROM telemetry_events;
    DELETE FROM messages;
    DELETE FROM settings;
    DELETE FROM users;
  `);
  sqlite.close();
}

export function resetKnowledgeDirectory() {
  rmSync(testKnowledgeDir, { recursive: true, force: true });
  mkdirSync(testKnowledgeDir, { recursive: true });
}

export async function importFresh<T>(relativePath: string): Promise<T> {
  const url = pathToFileURL(join(process.cwd(), relativePath));
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<T>;
}
