import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

const databasePath = process.env.DATABASE_URL || 'sqlite.db';
const sqlite = new Database(databasePath, { create: true });
export const db = drizzle(sqlite, { schema });
