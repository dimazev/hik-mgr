# Single stage on purpose: node_modules is intentionally NEVER copied into
# this image (there's no `deps` stage to copy it from anymore). Instead,
# bootstrap.sh installs dependencies and builds the app fresh every time a
# container actually starts — see bootstrap.sh for why. This image only
# needs to ship the source code and the OS-level tools that install/build
# depend on.
FROM node:22-alpine

WORKDIR /app

# python3/make/g++ = native build toolchain better-sqlite3 needs on
# alpine, required at container-start time now (bootstrap.sh runs
# `yarn install` there), not just at image-build time. ffmpeg is spawned
# as a subprocess by videoConvert.ts (post-download "shrink to 720p" step
# for download tasks) — also an OS-level dependency, not an npm one.
RUN apk add --no-cache python3 make g++ ffmpeg

# Source only. node_modules, dist/, and data/ are excluded via
# .dockerignore — dist/ gets (re)built and node_modules gets (re)installed
# by bootstrap.sh at container start instead of being baked in here.
COPY . .
RUN chmod +x bootstrap.sh

VOLUME ["/app/data"]
EXPOSE 4000

ENTRYPOINT ["./bootstrap.sh"]
