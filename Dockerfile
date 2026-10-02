# Navika - production image.
#
# Built for a platform that runs one long-lived Node process, because that is
# the only shape this app has: Socket.IO needs a persistent connection, so
# there is no serverless build of this and there will not be one.
#
#   docker build -t navika .
#   docker run -p 3010:3010 --env-file .env navika
#
# Two things this image deliberately does NOT do:
#
#   1. Run `prisma migrate deploy` at startup. It looks convenient and it is a
#      trap - two containers starting at once will race each other, and a
#      half-applied migration bricks the deploy. Migrations run once, as a
#      release step, before the new container serves traffic (see render.yaml).
#
#   2. Copy `.env` in. Secrets come from the platform's environment. The build
#      needs a placeholder DATABASE_URL only so the Prisma client can generate.

# ---------------------------------------------------------------- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# libc6/libssl are what Prisma's and pg's native builds link against. OpenSSL
# is the one people forget, and its absence only shows up at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copied on its own so the npm layer is cached until a dependency changes,
# rather than being invalidated by every source edit.
COPY package.json package-lock.json ./

# `npm ci` requires the lockfile to agree with package.json exactly, which is
# the point: it must not be allowed to silently resolve something newer.
RUN npm ci


# -------------------------------------------------------------- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma generate needs a syntactically valid URL but never connects. This is
# the only credential-shaped string baked into an image.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/navika?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1

# tsx runs server.ts in both dev and prod. It is a runtime dependency here, not
# a build-time convenience, because "build" and "start" share one command file.
RUN npm run build


# ------------------------------------------------------------ runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
# Default to 0.0.0.0. Node binds 0.0.0.0 already, but platforms that inject a
# HOSTNAME of their own (Render does) would otherwise make the app listen on a
# name that resolves to nothing.
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=build --chown=node:node /app/server.ts ./server.ts
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/package.json ./package.json

# This list is verified, not assumed: `npm run check:runtime-tree` builds a
# throwaway directory containing exactly these entries and boots the production
# server from it. A file missing from a Dockerfile is invisible until a
# container dies on startup, and nobody catches that in review.

# Runs as `node` (uid 1000), which exists in the base image. The npm install
# above ran as root, which is why the copied trees are chowned above.
USER node

EXPOSE 3010

# Hits the real endpoint, not a hardcoded 200. A process that is up but cannot
# reach Postgres is not healthy, and Docker should be the one to notice.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["npm", "run", "start"]
