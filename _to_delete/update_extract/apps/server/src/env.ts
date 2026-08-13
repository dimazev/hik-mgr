import 'dotenv/config';

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

export const env = {
  port: Number(process.env.PORT || 4000),
  // Falls back to an insecure default so local `yarn dev` works out of the
  // box, but anyone deploying for real should set a proper APP_SECRET in
  // .env — see .env.example.
  appSecret: required('APP_SECRET', 'dev-only-insecure-secret-change-me'),
  dbPath: process.env.DB_PATH || './data/hik-mgr.sqlite',
  hikDefault: hikDefault(),
};
