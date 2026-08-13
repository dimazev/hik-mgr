import './db/client'; // side effect: opens the DB and runs the inline migration
import { seedDefaultDeviceIfEmpty } from './db/seed';
import { env } from './env';
import { createServer } from './server';

seedDefaultDeviceIfEmpty();

const app = createServer();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`hik-mgr server listening on http://localhost:${env.port}`);
});
