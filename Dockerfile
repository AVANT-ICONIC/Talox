# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
# Keep this aligned with package-lock.json -> node_modules/playwright-core.
ARG PLAYWRIGHT_VERSION=1.59.1

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime

LABEL org.opencontainers.image.title="Talox" \
      org.opencontainers.image.description="Local browser runtime for AI agents" \
      org.opencontainers.image.source="https://github.com/AVANT-ICONIC/Talox" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TALOX_CHROMIUM_SANDBOX=true \
    HOME=/home/talox

WORKDIR /opt/talox
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build /src/dist ./dist
COPY src/schema ./src/schema
COPY LICENSE README.md CHANGELOG.md ./

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin talox \
    && mkdir -p /workspace/.talox-profiles /home/talox/.talox \
    && chown -R talox:talox /workspace /home/talox

USER talox
WORKDIR /workspace

VOLUME ["/workspace/.talox-profiles", "/home/talox/.talox"]

ENTRYPOINT ["node", "/opt/talox/dist/cli/talox.js"]
CMD ["--help"]
