#!/bin/sh
set -e

# Runs once every time the container actually starts (not at `docker
# build` time) — see the Dockerfile for why: node_modules is never copied
# into the image, so this is where it gets installed, fresh, against
# whatever Node/OS/arch this specific container is running on. That
# matters most for native modules like better-sqlite3, which otherwise
# risk being a precompiled binary baked in under one environment and then
# loaded under a subtly different one.

# Yarn runs each package's install/build script (compiling better-sqlite3,
# copying esbuild's prebuilt binary, etc.) in a scratch directory under
# $TMPDIR, which defaults to /tmp. Some Docker setups mount /tmp with
# restrictive options (e.g. noexec) that silently break exactly that kind
# of script — a downloaded/compiled binary can't be executed to verify it
# even though writing it succeeded. Pointing TMPDIR at a directory under
# /app (part of the normal bind-mounted filesystem, not a special mount)
# sidesteps that regardless of how the host's /tmp happens to be mounted.
export TMPDIR=/app/.yarn-tmp
mkdir -p "$TMPDIR"

echo "[bootstrap] installing dependencies (yarn install, from yarn.lock)..."
corepack enable
if ! yarn install --immutable; then
  # A package's own install/build script (esbuild, better-sqlite3, etc.)
  # failing prints only "couldn't be built successfully (exit code N, logs
  # can be found here: /tmp/xfs-.../build.log)" by default — the actual
  # reason lives in that log file, which isn't visible in `docker compose
  # logs` unless dumped explicitly. Do that here so a failure is
  # diagnosable from the container logs alone, without needing a shell
  # inside the container.
  echo "[bootstrap] yarn install failed — dumping any package build logs below:"
  for f in "$TMPDIR"/xfs-*/build.log /tmp/xfs-*/build.log; do
    if [ -f "$f" ]; then
      echo "----- $f -----"
      cat "$f"
    fi
  done
  exit 1
fi

# node_modules itself lives on tmpfs mounts (see docker-compose.yml) — RAM-
# backed and wiped on every container (re)start, never reused across
# restarts — so the yarn install above is always a genuinely fresh install,
# never skipping/reusing anything from a previous run. Build output isn't
# on tmpfs (it's on the bind-mounted source tree, so it survives a
# restart), so it's cleaned explicitly here: apps/web's `tsc -b` uses an
# incremental .tsbuildinfo cache that would otherwise skip recompiling
# unchanged files, and dist/ from a previous start would otherwise stick
# around unless the current build happens to overwrite every file it
# contains. `yarn clean` removes both, so every start is a genuine
# from-scratch compile of every .ts file, not an incremental one.
echo "[bootstrap] cleaning previous build output for a full rebuild..."
yarn clean

echo "[bootstrap] building shared -> server -> web..."
yarn build:shared
yarn build:server
yarn build:web

echo "[bootstrap] starting server..."
export NODE_ENV=production
exec node apps/server/dist/index.js
