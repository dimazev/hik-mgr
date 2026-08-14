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

## Running locally without Docker

Requires Node 22+ (the app itself has no Node-version-specific native
dependency beyond `better-sqlite3`, which has prebuilt binaries for
current LTS releases — Docker pins `node:22-alpine` for a known-good
build environment, independent of whatever Node version you have on your
host).

```bash
corepack enable   # if you don't already have yarn 4 available
yarn install
cp .env.example .env
# edit .env: set APP_SECRET, and optionally PORT / DB_PATH

yarn dev
```

`yarn dev` builds `packages/shared` once, then runs the server (`tsx
watch`, http://localhost:4000) and the Vite dev server
(http://localhost:5173, proxying `/api` to the server) concurrently.

For a production-style local run without Docker:

```bash
yarn build
yarn start   # serves both API and built web client on PORT (default 4000)
```

## Scripts

Run from the repo root (`yarn <script>`) unless noted otherwise.

| Script | What it does |
| --- | --- |
| `yarn dev` | Build `packages/shared` once, then run the server (`tsx watch`) and Vite dev server concurrently, for local development. |
| `yarn build` | Build `packages/shared`, then `apps/server`, then `apps/web`, in that order (each depends on the previous). |
| `yarn build:shared` / `yarn build:server` / `yarn build:web` | Build just one workspace — useful when iterating on a single piece without rebuilding everything. |
| `yarn start` | Run the already-built server (`node apps/server/dist/index.js`) — serves the API and, once `apps/web` is built, the web client too. Run `yarn build` first. |
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
  `dev: all (server+web)`, `web: dev`, `docker: up`, `docker: down`,
  `db: studio`, `clean`, `install`), so you don't need a separate
  terminal for them.
- **F5** (or the Run and Debug panel) offers:
  - **Debug Server** — runs the API server directly under Node's
    debugger via `tsx` (breakpoints work straight in the `.ts` sources,
    no separate compile step). Automatically runs the `build:shared`
    task first, since the server imports `@hik-mgr/shared`'s built
    output.
  - **Launch Web (Chrome)** — starts the Vite dev server (via the
    `web: dev` task) and opens it in a debuggable Chrome window, with
    breakpoints working in the `.tsx` sources.
  - **Full Stack: Server + Web** (a compound of the two above) — the
    one-press option: hit F5 once and both the server and the web
    client come up, debugger attached to both.
  - **Attach to Server (port 9229)** — attach to a server you already
    started yourself in a terminal (e.g. via `yarn dev`), instead of
    launching a new one. Needs that process to actually be listening on
    the debug port, e.g. `NODE_OPTIONS=--inspect yarn dev`.

## Configuration (`.env`)

| Variable      | Default                    | Notes                                                            |
| ------------- | --------------------------- | ------------------------------------------------------------------ |
| `PORT`        | `4000`                      | Server port.                                                       |
| `APP_SECRET`  | *(insecure dev default)*    | Key material for encrypting stored device passwords. Set this to a real random value for any real deployment — changing it later makes previously stored passwords undecryptable. |
| `DB_PATH`     | `./data/hik-mgr.sqlite`     | SQLite file location. In Docker this is `/app/data/hik-mgr.sqlite`, on the `data` volume. |
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

## API

All endpoints are under `/api`.

- `GET /api/devices` — list devices (no passwords included).
- `POST /api/devices` — add a device: `{ name, host, port?, protocol?, username?, password }`.
- `PUT /api/devices/:id` — update any subset of the same fields.
- `DELETE /api/devices/:id` — remove a device.
- `GET /api/devices/:id/status` — `{ status, info }` from `/ISAPI/System/status` and `/ISAPI/System/deviceInfo`.
- `GET /api/devices/:id/channels` — device/channel list (NVR proxy channels, falling back to the box's own video-input channels — same two-endpoint fallback as `hik-connect list-devices`).
- `GET /api/devices/:id/files[?track=101&start=...&end=...&max=2000]` — recorded-file search. Without `?track=`, searches every channel `channels` reports (same "search all devices by default" behavior as `hik-connect list-files`), tagging each result with `deviceChannelName`.
- `GET /api/devices/:id/download?uri=<playbackURI>` — streams the recording straight through to the browser as a file download.
- `GET /api/devices/:id/snapshot[?track=101]` — one JPEG still frame from that channel's current live view.

## Troubleshooting

### `better-sqlite3` fails to load ("Could not locate the bindings file")

Running locally (not Docker) and the server crashes on startup with a long
list of paths `bindings.js` tried under `node_modules/better-sqlite3/...`,
none of which exist? `better-sqlite3` is a native addon — it needs a
compiled `.node` binary matching your exact Node version, either
downloaded as a prebuilt binary during install or built from source with
`node-gyp`. This error means neither happened, almost always because
Xcode Command Line Tools (which provide the compiler `node-gyp` needs)
aren't installed, so the from-source build silently produced nothing
during `yarn install`.

Fix, no Node downgrade needed (this project already avoided the one
native-module dependency — `net-keepalive` in `hik-connect` — that
genuinely didn't support newer Node; `better-sqlite3` supports it fine
once actually built):

```bash
xcode-select --install   # if you haven't already; installs make/clang/python3
yarn rebuild:native      # rebuilds better-sqlite3 from source against your Node
yarn dev                 # or yarn start
```

If `xcode-select --install` says it's already installed, the rebuild step
alone is usually enough. This only affects running outside Docker — the
`Dockerfile` already installs `python3 make g++` on `node:22-alpine`
before `yarn install`, so `docker compose up --build` builds it correctly
without any of this.

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
