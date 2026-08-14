import { Router } from 'express';
import { env } from '../env';
import { SESSION_COOKIE, safeCompare, sessionCookieOptions, signSession, requireAuth, verifyShareToken } from '../auth';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  // Both comparisons run unconditionally (no `&&` short-circuit) so a
  // wrong username doesn't skip the password hash comparison and make
  // "valid username, wrong password" measurably faster to probe than
  // "invalid username" — same constant-time intent as safeCompare itself.
  const usernameOk = safeCompare(username, env.adminUsername);
  const passwordOk = safeCompare(password, env.adminPassword);
  if (!usernameOk || !passwordOk) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const token = signSession(env.adminUsername);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ username: env.adminUsername });
});

// Unauthenticated on purpose — this *is* the login mechanism for anyone
// holding the link. The token itself is the credential (see shareToken in
// auth.ts, and the full URL printed to the server log at startup); a
// missing/wrong token just falls through to a normal redirect to `/`
// (which shows the regular login page, since no cookie got set) rather
// than erroring, so a stale or mistyped link degrades gracefully instead
// of surfacing a confusing error page.
router.get('/auto-login', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (verifyShareToken(token)) {
    const sessionToken = signSession(env.adminUsername);
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  }
  res.redirect('/');
});

router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user!.username });
});

export default router;
