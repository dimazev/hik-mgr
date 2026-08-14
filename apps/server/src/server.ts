import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import devicesRouter from './api/devices';
import authRouter from './api/auth';
import { requireAuth } from './auth';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Left unauthenticated on purpose — infra/Docker health checks and load
  // balancers shouldn't need to carry a session cookie.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // /api/auth itself is unauthenticated (you need to be able to call
  // POST /login before you have a session) — GET /api/auth/me is guarded
  // internally instead (see api/auth.ts). Everything under /api/devices
  // requires a valid session.
  app.use('/api/auth', authRouter);
  app.use('/api/devices', requireAuth, devicesRouter);

  // Serves the web client's built static files on this same port/process
  // — the "everything through :4000" setup: `yarn build` (builds the web
  // client into apps/web/dist) then `yarn start` (runs this server), and
  // http://localhost:4000 serves both the API and the app, no separate
  // dev server or CORS/proxy concerns. Catch-all so React Router's
  // client-side routes work on a hard refresh too.
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // Generic error handler — routes use asyncHandler() to forward thrown
  // errors here instead of letting them crash the process. Must be
  // registered last: Express only routes an error to handlers defined
  // after the route that threw it.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: err?.message || 'Internal server error' });
  });

  return app;
}
