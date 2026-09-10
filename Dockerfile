FROM node:24.21.0-bookworm-slim AS base

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ENV PROTOS_SOURCE_CACHE=/tmp/protos-source

FROM base AS build
RUN npm run build

FROM base AS dev
EXPOSE 4321
CMD ["npm", "run", "dev"]

FROM ghcr.io/nginx/nginx-unprivileged:1.30.4-alpine3.24-slim@sha256:e88d990b349df8cf4aa82f16642d7a23375016638c9ace4e5c6ca25028e62e65 AS production

COPY --from=build --chown=101:0 /workspace/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
