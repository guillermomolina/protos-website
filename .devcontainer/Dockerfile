FROM node:22.23.2-bookworm AS node-runtime

FROM maven:3.9.16-eclipse-temurin-21

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

RUN useradd --create-home --shell /bin/bash node

WORKDIR /workspaces/protos-website

USER node
