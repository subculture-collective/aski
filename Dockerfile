# Two release images, see docs/runtime-recovery.md:
#   docker build --target api .  the account API (Node 24, runs the TypeScript sources directly)
#   docker build .               the web image: the static studio and about page behind nginx
FROM docker.io/library/node:24-alpine AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
# A stalled registry download fails within minutes and is retried, instead of hanging the build.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=5 --fetch-retry-maxtimeout=30000

FROM docker.io/library/node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production ASKI_API_HOST=0.0.0.0 ASKI_API_PORT=4181 ARTIFACT_ROOT=/data/artifacts ASKI_MIGRATE_ON_START=1
COPY --from=api-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
USER 10001:10001
EXPOSE 4181
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:4181/api/readyz || exit 1
ENTRYPOINT ["node", "server/main.ts"]

FROM docker.io/library/node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=5 --fetch-retry-maxtimeout=30000
COPY . ./
RUN npm run build && node scripts/check-build.mjs

FROM docker.io/library/nginx:1.31.8-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11
COPY ops/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
