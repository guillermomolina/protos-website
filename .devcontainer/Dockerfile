# Official Node image based on buildpack-deps with Git and Node.
FROM docker.io/library/node:22.23.2-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        make \
        bash-completion \
    && rm -rf /var/lib/apt/lists/*

RUN node --version && npm --version && git --version

RUN mkdir -p /workspaces/protos-website/node_modules \
    && chown -R node:node /workspaces/protos-website

WORKDIR /workspaces/protos-website
USER node
