FROM docker.io/library/node:22.23.2-bookworm AS node-runtime

FROM docker.io/library/maven:3.9.16-eclipse-temurin-21

COPY --from=node-runtime /usr/local /usr/local

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        python3 \
    && rm -rf /var/lib/apt/lists/* \
    && node --version \
    && npm --version \
    && mvn --version \
    && java -version

RUN (userdel --remove ubuntu 2>/dev/null || true) \
    && useradd --create-home --uid 1000 --shell /bin/bash node \
    && mkdir -p /workspaces/protos-website/node_modules \
    && chown -R node:node /workspaces

WORKDIR /workspaces/protos-website

USER node
