import path from 'node:path';
import dotenv from 'dotenv';

// Always load the repo-root .env, regardless of the process's current
// working directory — `yarn workspace @hik-mgr/server dev` (and thus
// `yarn dev`/VS Code's "Debug Server" launch config) runs with cwd set to
// apps/server, so plain `dotenv/config` (which reads .env from cwd) would
// silently miss the root .env in that case while still finding it when run
// via `yarn start` from the repo root. Resolving explicitly from
// __dirname avoids that inconsistency: apps/server/src (dev, via tsx) and
// apps/server/dist (prod, after `tsc` build) are both exactly three levels
// under the repo root.
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export interface HikDefault {
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  password: string;
}

// Optional "seed" device sourced from the environment — same convention as
// hik-connect's HIK_HOST/HIK_PORT/HIK_PROTOCOL/HIK_USERNAME/HIK_PASSWORD env
// vars. If HIK_HOST and HIK_PASSWORD are both set and the devices table is
// still empty on startup, this is inserted automatically so the app is
// usable immediately without going through the "Add device" form first —
// see db/seed.ts. Leave HIK_HOST/HIK_PASSWORD unset to skip seeding
// entirely and manage devices only through the UI/API.
function hikDefault(): HikDefault | null {
  const host = process.env.HIK_HOST;
  const password = process.env.HIK_PASSWORD;
  if (!host || !password) return null;

  return {
    name: process.env.HIK_NAME || host,
    host,
    port: Number(process.env.HIK_PORT || 80),
    protocol: (process.env.HIK_PROTOCOL as 'http' | 'https') || 'http',
    username: process.env.HIK_USERNAME || 'admin',
    password,
  };
}

// Same cwd-independence concern as the .env load above: resolve a relative
// DB_PATH against the repo root rather than whatever the process's cwd
// happens to be, so `yarn dev`, `yarn start`, and VS Code's F5 all end up
// pointing at the same `data/hik-mgr.sqlite`. Docker sets DB_PATH to an
// absolute path (/app/data/...), which passes through unchanged.
function resolveDbPath(): string {
  const configured = process.env.DB_PATH || './data/hik-mgr.sqlite';
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

export const env = {
  port: Number(process.env.PORT || 4000),
  // Falls back to an insecure default so local `yarn dev` works out of the
  // box, but anyone deploying for real should set a proper APP_SECRET in
  // .env — see .env.example.
  appSecret: required('APP_SECRET', 'dev-only-insecure-secret-change-me'),
  dbPath: resolveDbPath(),
  hikDefault: hikDefault(),
};
