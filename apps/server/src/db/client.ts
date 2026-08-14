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
    error TEXT,
    convert_status TEXT NOT NULL DEFAULT 'pending',
    convert_progress INTEGER,
    convert_error TEXT
  );
`);

// Columns added to download_task_files after it already shipped —
// CREATE TABLE IF NOT EXISTS above is a no-op against an existing table,
// so an ALTER TABLE is needed to backfill columns on a DB that already
// has the table without them. SQLite has no "ADD COLUMN IF NOT EXISTS",
// so each of these just tries the ALTER and swallows the "duplicate
// column" error on every later startup once it's already been added.
for (const alterStatement of [
  `ALTER TABLE download_task_files ADD COLUMN total_bytes INTEGER`,
  `ALTER TABLE download_task_files ADD COLUMN convert_status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE download_task_files ADD COLUMN convert_progress INTEGER`,
  `ALTER TABLE download_task_files ADD COLUMN convert_error TEXT`,
]) {
  try {
    sqlite.exec(alterStatement);
  } catch {
    // Column already exists — fine, this runs on every startup.
  }
}

export const db = drizzle(sqlite, { schema });
