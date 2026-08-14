# hik-mgr

A small full-stack app to manage one or more Hikvision devices (status,
channels, recorded-video search/download, snapshots) — the persistent,
multi-device successor to the one-off `hik-connect` CLI next door.

- **Server**: TypeScript + Express, talking to devices via raw ISAPI
  (digest auth + XML), same proven approach as `hik-connect`. Devices are
  stored in SQLite via Drizzle ORM; stored passwords are encrypted at rest
  (AES-256-GCM, keyed from `APP_SECRET`) and never returned by the API.
- **Web client**: React + MUI, talking to the server's JSON API.
- **Docker**: single container serves both — the server runs Express and,
  in production, also serves the web client's built static files.

Deliberately does **not** depend on `@copcart/node-hikvision-api` — that
library pulls in `net-keepalive` → `ffi-napi`/`ref-napi`, abandoned native
addons that don't build cleanly against newer Node versions (see
`hik-connect`'s README for the full story on that workaround). To avoid
repeating that risk here, `apps/server/src/hik/isapi.ts` is a direct
TypeScript port of the raw-ISAPI logic already proven in
`hik-connect/src/isapi.js`.

## Project layout

```
hik-mgr/
  apps/
    server/   TypeScript Express API + SQLite/Drizzle + ISAPI client
    web/      React + MUI client (Vite)
  packages/
    shared/   zod schemas & TS types shared between server and web
```

## Running with Docker (recommended)

```bash
cp .env.example .env
# edit .env and set a real APP_SECRET (any long random string)
docker compose up --build
```

Then open http://localhost:4000 — the server serves both the API
(`/api/...`) and the built web client. Device data persists in `./data/`
on the host (bind-mounted into the container).

**The image ships source only — `node_modules` is never baked in.**
`bootstrap.sh` runs `yarn install` and the full `yarn build` (shared →
server → web) itself, once, every time a container actually starts (see
`Dockerfile` / `bootstrap.sh` at the repo root). That means every start
does a real first-time-style install, so expect the container to sit on
"installing dependencies..." / "building shared -> server -> web..." in
`docker compose logs -f` for a while before "starting server..." — this
is normal, not a hang. The tradeoff is deliberate: it guarantees
`better-sqlite3` (and any other native module) is always compiled fresh
against the exact Node/OS/arch the container is actually running on,
instead of risking a precompiled binary that was baked into the image
under a slightly different environment. If you'd rather trade that
guarantee for a faster restart, you can mount a named volume over
`/app/node_modules` in `docker-compose.yml` so installed packages persist
across `docker compose up`/`down` (though not across `--build`, since
that recreates the image and, if you're not using a volume, the
container's writable layer with it).

## Running locally without Docker

Requires Node 22+ and **ffmpeg on your PATH** (`ffmpeg -version` should
work in your terminal) — download tasks automatically transcode each
recording to a smaller 720p copy after it downloads (see
[Download tasks](#download-tasks) below), by spawning `ffmpeg` as a
subprocess. If ffmpeg isn't installed, downloads themselves still work
fine; only that per-file conversion subtask fails, with a clear "ffmpeg
not found" error shown on the Tasks page for that file. Install it via
your OS package manager, e.g. `brew install ffmpeg` (macOS) or
`apt install ffmpeg` (Debian/Ubuntu). The Docker image already includes
it, nothing to do there.

`better-sqlite3` is pinned to `~12.10.0` specifically
because it's a version confirmed to build correctly against very new Node
releases (see [Troubleshooting](#troubleshooting) if you ever hit a
compile error here) — don't loosen that pin without checking. Docker pins
`node:22-alpine` for a known-good build environment, independent of
whatever Node version you have on your host.

```bash
corepack enable   # if you don't already have yarn 4 available
yarn install
cp .env.example .env
# edit .env: set APP_SECRET, and optionally PORT / DB_PATH

yarn dev
```

`yarn dev` builds `packages/shared` once, then runs the server (`tsx
watch`, http://localhost:4000) and the Vite dev server
(http://localhost:5173, proxying `/api` to the server) concurrently —
two ports, with live-reload on both the server and the web client.

### Single port (everything through :4000)

If you'd rather not juggle two dev ports and just hit one URL for
everything — build the web client once and let the Express server serve
it directly, same as Docker/production does:

```bash
yarn serve   # = yarn build && yarn start
```

Then open **http://localhost:4000** for the app, same origin as the API
— no proxy, no CORS concerns, nothing web-client-specific to configure
(it already calls relative `/api/...` paths, so this just works). The
tradeoff versus `yarn dev`: the web client isn't hot-reloading here, it's
a static build — re-run `yarn build:web` (or `yarn serve` again) after
changing anything under `apps/web/src`. The server itself still restarts
on change if you swap the final step for `yarn workspace @hik-mgr/server
dev` instead of `yarn start`.

## Scripts

Run from the repo root (`yarn <script>`) unless noted otherwise.

| Script | What it does |
| --- | --- |
| `yarn dev` | Build `packages/shared` once, then run the server (`tsx watch`) and Vite dev server concurrently, for local development. |
| `yarn build` | Build `packages/shared`, then `apps/server`, then `apps/web`, in that order (each depends on the previous). |
| `yarn build:shared` / `yarn build:server` / `yarn build:web` | Build just one workspace — useful when iterating on a single piece without rebuilding everything. |
| `yarn start` | Run the already-built server (`node apps/server/dist/index.js`) — serves the API and, once `apps/web` is built, the web client too. Run `yarn build` first. |
| `yarn serve` | `yarn build && yarn start` — the one-command "everything through :4000" workflow. See [Single port](#single-port-everything-through-4000) above. |
| `yarn db:generate` | Runs `drizzle-kit generate` against `apps/server/src/db/schema.ts` — emits SQL migration files under `apps/server/drizzle/` for review. Not required for this MVP (the server creates its one table itself on startup via an inline `CREATE TABLE IF NOT EXISTS` — see `apps/server/src/db/client.ts`), but useful once schema changes need a real, reviewable migration instead of that inline statement. |
| `yarn db:studio` | Opens [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview), a local web UI for browsing/editing the SQLite database directly — handy for inspecting stored devices without writing SQL by hand. |
| `yarn docker:build` | `docker compose build` — build the image without starting it. |
| `yarn docker:up` | `docker compose up --build` — build (if needed) and start the container, logs attached. |
| `yarn docker:down` | `docker compose down` — stop and remove the container. |
| `yarn clean` | Remove all three workspaces' `dist/` build output, for a clean rebuild. |

## VS Code: tasks and F5

Open the `hik-mgr` folder in VS Code (not a parent folder — the paths in
`.vscode/*.json` are relative to it) and:

- **Terminal → Run Task…** exposes every `yarn` script in
  [Scripts](#scripts) above as a task (`build`, `build:shared`,
  `build: shared + web (for single-port server)`, `dev: all (server+web)`,
  `web: dev`, `serve (single port :4000)`, `docker: up`, `docker: down`,
  `db: studio`, `clean`, `install`), so you don't need a separate
  terminal for them.
- **F5** (or the Run and Debug panel) — the **first/default** option is
  **Debug Server (single port :4000, build + run + open browser)**: press
  F5 and it builds `packages/shared` and `apps/web` (so the server has
  something to serve — without this, `apps/web/dist` doesn't exist and
  hitting `:4000` 404s on everything except `/api/...`), launches the
  server directly under Node's debugger via `tsx` (breakpoints work
  straight in the `.ts` sources, no separate server compile step), and
  once it actually logs that it's listening, opens
  **http://localhost:4000** in your browser automatically. One key press,
  everything running, fully debuggable.

  Other configs, for different workflows:
  - **Debug Server (API only, no web build)** — same debugger setup but
    skips building `apps/web`, for faster iteration when you only care
    about the API (`:4000/api/...` works, `:4000/` 404s unless a web
    build already exists from earlier).
  - **Launch Web (Chrome, :5173 dev server)** — starts the Vite dev
    server (hot-reload) and opens it in a debuggable Chrome window;
    needs the server running separately (e.g. the "API only" config
    above).
  - **Full Stack (two ports): Server + Web** — a compound of the two
    above, for active web development with hot-reload plus debugging on
    both sides at once.
  - **Attach to Server (port 9229)** — attach to a server you already
    started yourself in a terminal (e.g. via `yarn dev`), instead of
    launching a new one. Needs that process to actually be listening on
    the debug port, e.g. `NODE_OPTIONS=--inspect yarn dev`.

## Configuration (`.env`)

| Variable      | Default                    | Notes                                                            |
| ------------- | --------------------------- | ------------------------------------------------------------------ |
| `PORT`        | `4000`                      | Server port.                                                       |
| `APP_SECRET`  | *(insecure dev default)*    | Key material for encrypting stored device passwords **and** signing login session cookies. Set this to a real random value for any real deployment — changing it later makes previously stored passwords undecryptable and logs everyone out. |
| `DB_PATH`     | `./data/hik-mgr.sqlite`     | SQLite file location. In Docker this is `/app/data/hik-mgr.sqlite`, on the `data` volume. |
| `ADMIN_USERNAME` | `admin`                  | Login username for the whole app (see [Authentication](#authentication)). |
| `ADMIN_PASSWORD` | *(insecure dev default)* | Login password. Set a real value before running this anywhere beyond your own machine. |
| `HIK_NAME`    | *(unset)*                    | Optional. Display name for the seed device (see below). Defaults to `HIK_HOST` if unset. |
| `HIK_HOST`    | *(unset)*                    | Optional. Hikvision device host, e.g. `b22.kozow.com`. |
| `HIK_PORT`    | `80`                         | Optional. |
| `HIK_PROTOCOL`| `http`                       | Optional. `http` or `https`. |
| `HIK_USERNAME`| `admin`                      | Optional. |
| `HIK_PASSWORD`| *(unset)*                    | Optional. |

### Seeding the first device from `.env`

Instead of adding a device by hand through the UI, you can set
`HIK_HOST`/`HIK_PASSWORD` (and optionally `HIK_NAME`/`HIK_PORT`/
`HIK_PROTOCOL`/`HIK_USERNAME`) in `.env` — same convention as
`hik-connect`'s env vars. On startup, if the devices table is still empty
and both `HIK_HOST` and `HIK_PASSWORD` are set, that device is inserted
automatically (password encrypted at rest, same as any device added
through the UI). This only happens once: it's a one-time convenience seed
for a fresh database, not a "keep this device in sync with `.env`"
mechanism — once any device exists, changing `HIK_*` later has no effect.
Delete all devices via the UI/API first if you want it to reseed on next
start.

## Authentication

The whole app sits behind a single login — this isn't multi-user, it's
one admin account (`ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env`) gating
access to every device and every API route under `/api/devices`. Opening
the web app with no valid session shows a login page instead of the
device list; `/api/health` stays open (for infra health checks) and
`/api/auth/login` obviously has to be reachable before you have a
session, but everything else requires one.

How it works: `POST /api/auth/login` checks the submitted credentials
against `.env` (constant-time comparison, not stored anywhere else — no
user table, no password hashing at rest, since there's exactly one
account and it lives in `.env` like every other credential in this
project) and, on success, sets an httpOnly cookie containing a small
signed token (HMAC'd with `APP_SECRET`, 7-day expiry) — no server-side
session store needed, the cookie itself is the session. `GET
/api/auth/me` (used by the web client on load) and `POST
/api/auth/logout` round out the API; see [API](#api) below.

Practical notes:
- Changing `APP_SECRET` invalidates every existing session (the HMAC no
  longer verifies), same as it invalidates stored device passwords — see
  the config table above.
- The cookie is `sameSite: 'lax'` and only requires HTTPS in production
  (`NODE_ENV=production`, which the Dockerfile sets) — plain `http://` on
  `yarn dev`/`yarn serve` still works.
- This assumes the web client and API are same-origin, true for every
  documented setup here (`yarn serve`'s single port, Docker, and `yarn
  dev`'s Vite proxy). Opening the web app from a genuinely different
  origin than the API wouldn't carry the cookie without additional CORS
  configuration — out of scope for this MVP.

## API

All endpoints are under `/api`. Everything under `/api/devices` requires
a valid login session — see [Authentication](#authentication).

- `POST /api/auth/login` — `{ username, password }` → `{ username }` and sets the session cookie, or `401` on bad credentials.
- `POST /api/auth/logout` — clears the session cookie.
- `GET /api/auth/me` — `{ username }` if logged in, `401` otherwise. Used by the web client on load to decide login page vs. app.
- `GET /api/devices` — list devices (no passwords included).
- `POST /api/devices` — add a device: `{ name, host, port?, protocol?, username?, password }`.
- `PUT /api/devices/:id` — update any subset of the same fields.
- `DELETE /api/devices/:id` — remove a device.
- `GET /api/devices/:id/status` — `{ status, info }` from `/ISAPI/System/status` and `/ISAPI/System/deviceInfo`.
- `GET /api/devices/:id/channels` — device/channel list (NVR proxy channels, falling back to the box's own video-input channels — same two-endpoint fallback as `hik-connect list-devices`), each with `label`: a custom name if one's been set (see below), `null` otherwise.
- `PUT /api/devices/:id/channels/:channelId/label` — `{ label }` sets a custom display label for that channel, stored locally (not on the device — the ISAPI channel list itself is always fetched live, never cached). An empty `label` clears it, reverting to the device-reported name.
- `GET /api/devices/:id/files[?track=101&start=...&end=...&max=2000]` — recorded-file search. Without `?track=`, searches every channel `channels` reports (same "search all devices by default" behavior as `hik-connect list-files`), tagging each result with `deviceChannelName`.
- `GET /api/devices/:id/download?uri=<playbackURI>` — streams the recording straight through to the browser as a file download.
- `GET /api/devices/:id/snapshot[?track=101]` — one JPEG still frame from that channel's current live view.
- `POST /api/devices/:id/download-tasks` — `{ files: [...] }` queues a [download task](#download-tasks); returns `{ taskId }` immediately.
- `GET /api/tasks` / `GET /api/tasks/:taskId` — list/inspect download tasks (across every device).
- `POST /api/tasks/:taskId/cancel`, `POST /api/tasks/:taskId/resume` — stop a task ASAP / re-run its outstanding work.
- `GET /api/tasks/:taskId/files/:fileId/download` — streams that file's *converted* copy once ready.

## Download tasks

Recording downloads (from the Recordings tab's search → file list → single
"Download" button) don't stream straight to the browser — they queue a
**download task** that the server works through in the background, one
file at a time:

1. **Download** the raw recording from the device to `data/downloads/task-<id>/` (resumable via HTTP Range, same as `hik-connect`).
2. **Convert** — once that file's download succeeds, ffmpeg immediately transcodes it to a smaller 720p copy in the same folder:
   ```
   ffmpeg -i <in> -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow -an -movflags +faststart <out>
   ```
   This is a *subtask* of the file, tracked and resumed independently of the download itself — a file can be fully downloaded while its conversion is still pending, in progress, or failed (most commonly because ffmpeg isn't installed — see [Running locally without Docker](#running-locally-without-docker)).

Progress for both subtasks — bytes downloaded, ffmpeg's percent complete —
updates live on the **Tasks** page (linked from the top bar) roughly once
a second, and is also logged to the server console
(`[download-task <id>] ...`). From there you can:

- **Cancel** a pending/running task — aborts whatever's actively in flight (the HTTP download stream or the ffmpeg process) immediately, not just before the next file.
- **Resume** a failed/cancelled/interrupted task — re-attempts only the outstanding work: files not yet downloaded (resuming a partial file on disk rather than restarting it), and files downloaded but not yet converted. Safe to click repeatedly.
- **Download** the converted copy of any file whose conversion subtask is `done` — the only point in this flow that streams a file to the browser; the raw downloaded file stays server-side in `data/downloads/`.

If the server process restarts while a task is mid-download or
mid-conversion, that task is marked `interrupted` on the next startup
(nothing is silently lost — see `markStaleRunningTasksInterrupted` in
`apps/server/src/db/downloadTasks.ts`) and shows up on the Tasks page as
resumable, same as a failed or cancelled one.

## Troubleshooting

### Resuming a download task restarts a file from 0% instead of continuing

Check the server log for that file's line — resuming logs one of two
outcomes for each file it resumes:

```
"<file>": device honored resume, continuing from 1234 KB
"<file>": device did not honor resume (replied 200, not 206) — re-downloading the full file from byte 0 instead of continuing from the 1234 KB already on disk
```

If you see the second line, this isn't a hik-mgr bug — it's the device's
firmware. `downloadRecording` (`apps/server/src/hik/isapi.ts`) sends a
`Range: bytes=<existingBytes>-` header on `/ISAPI/ContentMgmt/download`
when there's already a partial file on disk, but not every Hikvision
firmware honors `Range` on that particular endpoint. The code only trusts
a resume if the device actually replies `206 Partial Content`; if it
replies `200 OK` instead, that means it's sending the *whole* file from
byte 0 again regardless of what was asked for, so the partial file on disk
is correctly truncated and rewritten from scratch rather than corrupted by
splicing old and new bytes together. This is the exact same resume logic
`hik-connect` used — carried over unchanged, not something new to hik-mgr.

There's no code-side fix for this: if the device doesn't support Range
here, "resume" is necessarily a full re-download over the network every
time, no matter which client makes the request. If your device *does*
report `206` (check the log line above) but you're still seeing a restart
from 0%, that's a real bug worth reporting — but the more common case,
especially on older DVR/NVR firmware, is simply no Range support on this
endpoint.

### `better-sqlite3` fails to load or fails to compile

Running locally (not Docker) and the server crashes with either a
"Could not locate the bindings file" error listing a long list of tried
paths, or a `node-gyp`/`gyp ERR!` compile error (possibly mentioning a
removed V8 API, e.g. `no member named 'This' in
'v8::PropertyCallbackInfo<v8::Value>'`)?

That specific compile error means the installed `better-sqlite3` version
is too old for your Node's V8 — this isn't a missing-tool or
wrong-Node-version problem, it's a real incompatibility between that
addon release and a newer V8. `better-sqlite3` is pinned to `~12.10.0` in
`apps/server/package.json` specifically because that version is confirmed
to build correctly on very new Node releases (verified working in another
project on this same machine). If you've somehow ended up on an older
`11.x` (e.g. a stale lockfile), that's very likely the cause:

```bash
yarn install                       # picks up the ~12.10.0 pin
yarn rebuild:native                # if still needed: rebuilds from source
yarn dev
```

If you're already on `~12.10.0` and it's still failing, first make sure
Xcode Command Line Tools are installed (`xcode-select -p` should print a
path; if not, `xcode-select --install`), then run
`yarn rebuild:native` (`npm rebuild better-sqlite3 --build-from-source`
under the hood) to force a fresh from-source build against your exact
Node, rather than relying on a prebuilt binary that might not exist yet
for a brand-new Node release.

This only affects running outside Docker — the `Dockerfile` already
installs `python3 make g++` on `node:22-alpine` before `yarn install`, so
`docker compose up --build` isn't affected either way.

## Notes / known limitations of this MVP

- `/download` streams live (no server-side buffering) but has no
  resume-on-failure support the way `hik-connect`'s CLI download does —
  that's a CLI-specific feature (retrying a local `fetch`/`curl`) more
  than a server one; a browser download that fails can just be retried
  from the UI.
- The DB migration is a single inline `CREATE TABLE IF NOT EXISTS` in
  `apps/server/src/db/client.ts` — fine for this one-table MVP, but real
  schema changes later should move to `drizzle-kit generate` + a proper
  migration runner.
- `@mhoc/axios-digest-auth` ships no TypeScript types; a minimal ambient
  declaration lives at `apps/server/src/types/axios-digest-auth.d.ts`
  covering just the surface this project uses.
