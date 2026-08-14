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

  CREATE TABLE IF NOT EXISTS recording_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    earliest_start TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    truncated INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (device_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS download_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_files INTEGER NOT NULL DEFAULT 0,
    completed_files INTEGER NOT NULL DEFAULT 0,
    failed_files INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS download_task_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    channel_name TEXT NOT NULL,
    playback_uri TEXT NOT NULL,
    filename TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    size_bytes INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
`);

export const db = drizzle(sqlite, { schema });
