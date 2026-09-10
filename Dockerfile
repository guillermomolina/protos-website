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
