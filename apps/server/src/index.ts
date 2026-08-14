import './db/client'; // side effect: opens the DB and runs the inline migration
import { seedDefaultDeviceIfEmpty } from './db/seed';
import { markStaleRunningTasksInterrupted } from './db/downloadTasks';
import { env } from './env';
import { createServer } from './server';
import { shareToken } from './auth';

seedDefaultDeviceIfEmpty();

// Any download task still marked 'running' from before this start belonged
// to a worker in a previous process — there's nothing actually downloading
// it anymore, so relabel it 'interrupted' rather than leaving it looking
// falsely active forever. It's resumable from the Tasks page like any
// other stopped task (see downloadWorker.ts / POST /api/tasks/:id/resume).
const interruptedCount = markStaleRunningTasksInterrupted();
if (interruptedCount > 0) {
  // eslint-disable-next-line no-console
  console.log(`Marked ${interruptedCount} download task(s) as interrupted after restart.`);
}

const app = createServer();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`hik-mgr server listening on http://localhost:${env.port}`);

  // A one-click "log in as admin" link — visiting it sets the same session
  // cookie a normal password login would, no credentials needed. Printed
  // fresh on every start (not just the first) so it's always easy to find
  // in `docker compose logs`/`docker logs` without having to remember to
  // scroll back to the very first boot. Always printed against localhost —
  // deliberately not trying to guess/configure the externally-reachable
  // host (reverse proxy domain, LAN IP, etc.); swap that part of the URL
  // yourself before sharing it if this host isn't reachable as printed.
  // eslint-disable-next-line no-console
  console.log(
    `Auto-login share URL — anyone with this link is logged in as ${env.adminUsername} automatically, ` +
      `no password needed. Treat it like the admin password:\n` +
      `  http://localhost:${env.port}/api/auth/auto-login?token=${shareToken()}`
  );
});
