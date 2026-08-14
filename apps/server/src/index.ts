import './db/client'; // side effect: opens the DB and runs the inline migration
import { seedDefaultDeviceIfEmpty } from './db/seed';
import { markStaleRunningTasksInterrupted } from './db/downloadTasks';
import { env } from './env';
import { createServer } from './server';

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
});
