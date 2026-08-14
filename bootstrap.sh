#!/bin/sh
set -e

# Runs once every time the container actually starts (not at `docker
# build` time) — see the Dockerfile for why: node_modules is never copied
# into the image, so this is where it gets installed, fresh, against
# whatever Node/OS/arch this specific container is running on. That
# matters most for native modules like better-sqlite3, which otherwise
# risk being a precompiled binary baked in under one environment and then
# loaded under a subtly different one.

# node_modules lives on regular (exec-capable) anonymous volumes — see
# docker-compose.yml for why not tmpfs — which DO persist across a
# `docker compose restart` by default. To get "never reuse packages from a
# previous run" anyway, wipe them explicitly before every install rather
# than relying on the mount type to do it. rm -rf on an empty/nonexistent
# dir is a harmless no-op, so this is safe on a container's very first
# start too.
echo "[bootstrap] clearing node_modules for a genuinely fresh install..."
rm -rf node_modules packages/shared/node_modules apps/server/node_modules apps/web/node_modules

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
  for f in /tmp/xfs-*/build.log; do
    if [ -f "$f" ]; then
      echo "----- $f -----"
      cat "$f"
    fi
  done
  exit 1
fi

# Build output isn't wiped above (it's on the bind-mounted source tree, so
# it survives a restart on its own) — cleaned explicitly here instead:
# apps/web's `tsc -b` uses an incremental .tsbuildinfo cache that would
# otherwise skip recompiling unchanged files, and dist/ from a previous
# start would otherwise stick around unless the current build happens to
# overwrite every file it contains. `yarn clean` removes both, so every
# start is a genuine from-scratch compile of every .ts file, not an
# incremental one.
echo "[bootstrap] cleaning previous build output for a full rebuild..."
yarn clean

echo "[bootstrap] building shared -> server -> web..."
yarn build:shared
yarn build:server
yarn build:web

echo "[bootstrap] starting server..."
export NODE_ENV=production
exec node apps/server/dist/index.js
