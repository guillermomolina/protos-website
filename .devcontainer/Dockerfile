FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        python3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/protos-website

USER node
