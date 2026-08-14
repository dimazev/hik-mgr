import { Router } from 'express';
import { env } from '../env';
import { SESSION_COOKIE, safeCompare, sessionCookieOptions, signSession, requireAuth } from '../auth';

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

router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user!.username });
});

export default router;
