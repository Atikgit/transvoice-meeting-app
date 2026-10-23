# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-alpine

# ---- deps: install with the lockfile only ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- geoip: GeoLite2-Country for signup country (optional) ----
# Separate stage so the license key never reaches the runtime image. A missing key or a failed
# download only logs a warning: the app then stores a null country.
FROM node:${NODE_VERSION} AS geoip
ARG MAXMIND_LICENSE_KEY
# Change (e.g. to the current date) to re-download instead of reusing the cached layer.
ARG GEOIP_REFRESH
WORKDIR /geoip
RUN if [ -z "$MAXMIND_LICENSE_KEY" ]; then \
      echo "MAXMIND_LICENSE_KEY not set: building without the GeoLite2 database."; \
    elif wget -qO /tmp/geoip.tar.gz \
      "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
      && tar -xzf /tmp/geoip.tar.gz -C /tmp \
      && mv /tmp/GeoLite2-Country_*/GeoLite2-Country.mmdb /geoip/; then \
      echo "GeoLite2-Country downloaded${GEOIP_REFRESH:+ ($GEOIP_REFRESH)}."; \
    else \
      echo "WARNING: GeoLite2 download failed: building without it."; \
    fi; \
    rm -rf /tmp/geoip.tar.gz /tmp/GeoLite2-Country_*

# ---- build ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime: standalone server only, no dev dependencies or source ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=geoip --chown=nextjs:nodejs /geoip ./geoip

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Server secrets come from the environment at runtime; lib/env.ts validates them on start.
CMD ["node", "server.js"]
