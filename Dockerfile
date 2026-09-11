FROM --platform=$BUILDPLATFORM maven:3.9.16-eclipse-temurin-21@sha256:a972570be789ee5c9fa23446a8914ac7327560b5c022f662cfa9452aef829f18 AS protos-doc-toolchain

FROM --platform=$BUILDPLATFORM node:24.21.0-bookworm-slim AS base

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=protos-doc-toolchain /opt/java/openjdk /opt/java/openjdk
COPY --from=protos-doc-toolchain /usr/share/maven /usr/share/maven

ENV JAVA_HOME=/opt/java/openjdk
ENV MAVEN_HOME=/usr/share/maven
ENV PATH="${JAVA_HOME}/bin:${MAVEN_HOME}/bin:${PATH}"

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ENV PROTOS_SOURCE_CACHE=/tmp/protos-source

FROM base AS build
RUN npm run build

FROM base AS dev
USER node
EXPOSE 4321
CMD ["npm", "run", "dev"]

FROM ghcr.io/nginx/nginx-unprivileged:1.30.4-alpine3.24-slim@sha256:e88d990b349df8cf4aa82f16642d7a23375016638c9ace4e5c6ca25028e62e65 AS production

COPY --from=build --chown=101:0 /workspace/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
