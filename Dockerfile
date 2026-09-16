# syntax=docker/dockerfile:1

# ===========================================
# Stage 1: Dependencies
# ===========================================
FROM node:22-alpine AS deps
WORKDIR /app

# Install libc6-compat for Alpine compatibility
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (BuildKit cache keeps the npm cache across builds)
RUN --mount=type=cache,target=/root/.npm npm ci

# ===========================================
# Stage 2: Builder
# ===========================================
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Public origin (canonical URL, metadataBase, sitemap, OG URLs). NEXT_PUBLIC_*
# values are inlined into the JS bundle at build time, so this MUST arrive as a
# build-arg. There is deliberately no default: a forgotten build-arg used to
# ship a site whose metadata pointed at http://localhost:3000. next.config.ts
# fails the build when it is unset.
#
# Every NEXT_PUBLIC_* variable the app reads must be listed here as an ARG and
# passed by the deploy pipeline, or the deployed bundle silently ships without it.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_BAT_PHONE_NUMBER

# Dummy values for the build only. Next.js evaluates src/lib/auth.ts and
# src/db/primary.ts while collecting page data, and both throw without env.
# Declared as ARG (not ENV) so they never persist in image metadata and can
# never be mistaken for runtime configuration. Real values are provided at
# runtime by the orchestrator.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG BETTER_AUTH_SECRET=build-secret-not-used-at-runtime
ARG BETTER_AUTH_URL=http://localhost:3000
ARG GOOGLE_CLIENT_ID=build-dummy
ARG GOOGLE_CLIENT_SECRET=build-dummy

# Build the application. Values are scoped to this single RUN.
# NODE_OPTIONS: next build can exceed the default heap on small builders.
RUN --mount=type=cache,target=/app/.next/cache \
  NODE_OPTIONS="--max-old-space-size=4096" \
  DATABASE_URL=${DATABASE_URL} \
  BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET} \
  BETTER_AUTH_URL=${BETTER_AUTH_URL} \
  GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID} \
  GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET} \
  NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
  NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
  NEXT_PUBLIC_BAT_PHONE_NUMBER=${NEXT_PUBLIC_BAT_PHONE_NUMBER} \
  npm run build

# ===========================================
# Stage 3: Migrations
# ===========================================
FROM node:22-alpine AS migrations
WORKDIR /app

# Copy dependencies, config, and the committed migrations
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY src/db ./src/db
COPY src/lib/logger.ts ./src/lib/logger.ts

# Apply committed migrations. Never `drizzle-kit push` here: push has no
# journal, cannot be reviewed, hangs in headless containers, and skips
# migration tracking, which is how a production schema drifted from the files.
CMD ["npx", "drizzle-kit", "migrate"]

# ===========================================
# Stage 4: Runner (Production)
# ===========================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install wget for ECS container health checks
RUN apk add --no-cache wget

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder, owned by the runtime user
# (copying then chown -R would duplicate the whole app in an extra layer)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check for container orchestrators (Docker, ECS)
# Uses liveness endpoint - returns 200 if app is running.
# start-period 30s: a standalone Next server on a small task regularly takes
# longer than 10s to cold start, which caused restart loops.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
