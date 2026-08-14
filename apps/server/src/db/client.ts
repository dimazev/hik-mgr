import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../env';
import * as schema from './schema';

const dbDir = path.dirname(env.dbPath);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(env.dbPath);
sqlite.pragma('journal_mode = WAL');

// Minimal inline migration — good enough for this MVP's small schema.
// For real schema evolution, use `drizzle-kit generate` + a proper
// migrations runner instead of this ad-hoc CREATE TABLE.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 80,
    protocol TEXT NOT NULL DEFAULT 'http',
    username TEXT NOT NULL DEFAULT 'admin',
    password_enc TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (device_id, channel_id)
  );
`);

export const db = drizzle(sqlite, { schema });
