# Official Node image based on buildpack-deps with Git and Node.
# No Maven, JDK, Ubuntu APT update or extra packages.
FROM docker.io/library/node:22.23.2-bookworm

RUN node --version && npm --version && git --version

RUN mkdir -p /workspaces/protos-website/node_modules \
    && chown -R node:node /workspaces/protos-website

WORKDIR /workspaces/protos-website
USER node
