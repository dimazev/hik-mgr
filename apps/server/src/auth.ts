import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from './env';

export const SESSION_COOKIE = 'hik_mgr_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Constant-time string comparison for credentials — hashes both sides to
 * a fixed-length digest first so mismatched-length inputs (e.g. a wrong
 * password of a different length than the real one) don't leak length
 * information via early-exit comparison, then compares those digests with
 * `crypto.timingSafeEqual`.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

interface SessionPayload {
  username: string;
  exp: number;
}

/**
 * Signs a small JSON payload into `<base64url-payload>.<base64url-hmac>`,
 * keyed off APP_SECRET — a stateless session token (no server-side session
 * store/table needed) that `verifySession` below can validate without
 * trusting anything the client sends unchecked.
 */
export function signSession(username: string): string {
  const payload: SessionPayload = { username, exp: Date.now() + SESSION_MAX_AGE_MS };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', env.appSecret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', env.appSecret).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    // Catches the case where ADMIN_USERNAME was changed in .env after this
    // token was issued — old tokens for the previous username stop working
    // rather than silently still granting access under the new identity.
    if (payload.username !== env.adminUsername) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * A stable "magic link" token that logs in as the admin user without a
 * password — deterministically derived from APP_SECRET (HMAC'd with a
 * fixed label) rather than randomly generated and stored, so it doesn't
 * need its own table/row and stays valid across restarts as long as
 * APP_SECRET itself doesn't change. Rotating APP_SECRET invalidates this
 * the same way it invalidates every existing session — that's the
 * "revoke access" lever if a shared link needs to stop working.
 *
 * Printed as a full URL at server startup (see printAutoLoginUrl in
 * index.ts) so it's easy to copy out of `docker compose logs` and hand to
 * someone else — anyone with this URL can log in as the admin, so treat it
 * with the same care as the admin password itself.
 */
export function shareToken(): string {
  return crypto.createHmac('sha256', env.appSecret).update('hik-mgr-auto-login-v1').digest('base64url');
}

/** Constant-time check against shareToken() — same reasoning as safeCompare. */
export function verifyShareToken(token: string | undefined): boolean {
  if (!token) return false;
  const expected = shareToken();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Only require HTTPS for the cookie in production — plain `yarn dev`/
    // `yarn serve` over http://localhost would otherwise silently never
    // send the cookie back and logins would appear to "not stick".
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: { username: string };
    }
  }
}

/** Applied to every route that requires a logged-in session (see server.ts). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = { username: session.username };
  next();
}
