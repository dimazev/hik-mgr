import { devices } from './schema';
import { db } from './client';
import { env } from '../env';
import { encryptSecret } from '../crypto';

/**
 * Inserts the HIK_HOST/HIK_PORT/HIK_PROTOCOL/HIK_USERNAME/HIK_PASSWORD
 * device from .env as the first device, but only if the table is still
 * empty — this is a one-time convenience seed, not a "keep this device in
 * sync with .env" mechanism. Once any device exists (including one added
 * by hand through the UI), this is a no-op forever, even if HIK_* env
 * vars change later. Delete all devices via the UI/API to have it reseed
 * on next start, if that's ever wanted.
 */
export function seedDefaultDeviceIfEmpty(): void {
  if (!env.hikDefault) return;

  const existingCount = db.select().from(devices).all().length;
  if (existingCount > 0) return;

  db.insert(devices)
    .values({
      name: env.hikDefault.name,
      host: env.hikDefault.host,
      port: env.hikDefault.port,
      protocol: env.hikDefault.protocol,
      username: env.hikDefault.username,
      passwordEnc: encryptSecret(env.hikDefault.password),
    })
    .run();

  // eslint-disable-next-line no-console
  console.log(`Seeded default device "${env.hikDefault.name}" (${env.hikDefault.host}) from .env`);
}
