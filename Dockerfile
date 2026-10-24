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
RUN npm ci && chown -R node:node /workspace/node_modules
COPY . .

ENV PROTOS_SOURCE_CACHE=/tmp/protos-source

FROM base AS build
RUN npm run build

FROM base AS dev
USER node
EXPOSE 4321
CMD ["npm", "run", "dev"]

FROM ghcr.io/nginx/nginx-unprivileged:1.30.6-alpine3.24@sha256:517607ae849a46afbd400616a783e4ead0290f52d20ccc0618ccea1a49362474 AS production

# The official non-slim image includes the matching njs module.
# No package installation is performed in this image.
USER root
RUN sed -i '1i load_module modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf
USER 101

# Reuse the DNS resolvers provided by the container runtime.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

COPY --chown=101:0 server/github-release.js /etc/nginx/njs/github-release.js
COPY --chown=101:0 server/github-announcements-core.js /etc/nginx/njs/github-announcements-core.js
COPY --chown=101:0 server/github-announcements-service.js /etc/nginx/njs/github-announcements-service.js
COPY --chown=101:0 server/github-announcements.js /etc/nginx/njs/github-announcements.js
COPY --chown=101:0 server/github-project-status-core.js /etc/nginx/njs/github-project-status-core.js
COPY --chown=101:0 server/github-project-status-service.js /etc/nginx/njs/github-project-status-service.js
COPY --chown=101:0 server/github-project-status.js /etc/nginx/njs/github-project-status.js
COPY --chown=101:0 server/github-document-revision-core.js /etc/nginx/njs/github-document-revision-core.js
COPY --chown=101:0 server/github-document-revision-service.js /etc/nginx/njs/github-document-revision-service.js
COPY --chown=101:0 server/github-document-revision.js /etc/nginx/njs/github-document-revision.js
COPY --chown=101:0 server/github-document-source-core.js /etc/nginx/njs/github-document-source-core.js
COPY --chown=101:0 server/github-document-source-service.js /etc/nginx/njs/github-document-source-service.js
COPY --chown=101:0 server/github-document-catalog-core.js /etc/nginx/njs/github-document-catalog-core.js
COPY --chown=101:0 server/github-document-catalog-service.js /etc/nginx/njs/github-document-catalog-service.js
COPY --chown=101:0 server/github-document-catalog-cache.js /etc/nginx/njs/github-document-catalog-cache.js
COPY --chown=101:0 server/github-document-catalog.js /etc/nginx/njs/github-document-catalog.js
COPY --chown=101:0 server/nginx/default.conf.template /etc/nginx/templates/default.conf.template


COPY --from=build --chown=101:0 /workspace/dist/ /usr/share/nginx/html/

COPY --chown=101:0 server/github-document-content-cache.js /etc/nginx/njs/github-document-content-cache.js
COPY --chown=101:0 server/github-document.js /etc/nginx/njs/github-document.js
COPY --chown=101:0 server/ghcr-d064-core.js /etc/nginx/njs/ghcr-d064-core.js
COPY --chown=101:0 server/ghcr-d064-service.js /etc/nginx/njs/ghcr-d064-service.js
COPY --chown=101:0 server/ghcr-d064-publications-core.js /etc/nginx/njs/ghcr-d064-publications-core.js
COPY --chown=101:0 server/ghcr-d064-publications-service.js /etc/nginx/njs/ghcr-d064-publications-service.js
COPY --chown=101:0 server/ghcr-d064-publications-cache.js /etc/nginx/njs/ghcr-d064-publications-cache.js
COPY --chown=101:0 server/ghcr-d064-content-cache.js /etc/nginx/njs/ghcr-d064-content-cache.js
COPY --chown=101:0 server/ghcr-d064.js /etc/nginx/njs/ghcr-d064.js

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
