# --- deps: install once, reused by build and runtime for a consistent tree ---
FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 needs a native build toolchain on alpine.
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json .yarnrc.yml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN yarn install

# --- build: compile shared -> server -> web ---
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN yarn build:shared && yarn build:server && yarn build:web

# --- runtime: only what's needed to run the server + serve the built web app ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is spawned as a subprocess by videoConvert.ts (post-download
# "shrink to 720p" step for download tasks) — not an npm dependency, so it
# has to be installed at the OS level here.
RUN apk add --no-cache ffmpeg
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist

VOLUME ["/app/data"]
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]
