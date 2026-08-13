import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import devicesRouter from './api/devices';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/devices', devicesRouter);

  // Generic error handler — routes use asyncHandler() to forward thrown
  // errors here instead of letting them crash the process.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: err?.message || 'Internal server error' });
  });

  // In production, the web client's built static files live alongside the
  // server (see the Dockerfile) — serve them, with a catch-all so React
  // Router's client-side routes work on a hard refresh too.
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

  return app;
}
