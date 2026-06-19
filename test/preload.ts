import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const tempRoot = mkdtempSync(join(tmpdir(), 'cybrabot-test-'));
const dbPath = join(tempRoot, 'sqlite.db');
const knowledgeDir = join(tempRoot, 'knowledge');

mkdirSync(knowledgeDir, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = dbPath;
process.env.KNOWLEDGE_DIR = knowledgeDir;
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.TELEGRAM_BOT_TOKEN = '999999:TEST_TOKEN';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';

(globalThis as Record<string, unknown>).__CYBRA_TEST_TEMP_ROOT = tempRoot;
(globalThis as Record<string, unknown>).__CYBRA_TEST_DB_PATH = dbPath;
(globalThis as Record<string, unknown>).__CYBRA_TEST_KNOWLEDGE_DIR = knowledgeDir;

const bootstrapUrl = pathToFileURL(join(process.cwd(), 'db/bootstrap.ts'));
bootstrapUrl.searchParams.set('t', String(Date.now()));
await import(bootstrapUrl.href);
