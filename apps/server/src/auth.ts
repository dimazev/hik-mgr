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
