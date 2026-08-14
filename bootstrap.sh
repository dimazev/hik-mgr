#!/bin/sh
set -e

# Runs once every time the container actually starts (not at `docker
# build` time) — see the Dockerfile for why: node_modules is never copied
# into the image, so this is where it gets installed, fresh, against
# whatever Node/OS/arch this specific container is running on. That
# matters most for native modules like better-sqlite3, which otherwise
# risk being a precompiled binary baked in under one environment and then
# loaded under a subtly different one.

# node_modules lives on regular (exec-capable) volume mounts, one per
# workspace, each at its real project-relative path — see the long
# comment in docker-compose.yml for why not tmpfs and not one shared
# volume symlinked into place. Volumes DO persist across a
# `docker compose restart` by default, so to get "never reuse packages
# from a previous run" anyway, each is emptied explicitly before every
# install rather than relying on the mount type to do it.
#
# `find -mindepth 1 -delete` (not `rm -rf <dir>`) deliberately clears each
# directory's *contents* without removing the directory itself — these
# paths are active mount points, and `rm -rf` trying to remove a mount
# point out from under itself would fail with "device busy" and — since
# this script runs with set -e — abort the whole bootstrap. mkdir -p first
# covers a directory that doesn't exist yet (a container's very first
# start).
echo "[bootstrap] clearing node_modules for a genuinely fresh install..."
for dir in node_modules packages/shared/node_modules apps/server/node_modules apps/web/node_modules; do
  mkdir -p "$dir"
  find "$dir" -mindepth 1 -delete
done

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
