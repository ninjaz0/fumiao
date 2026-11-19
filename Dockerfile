FROM node:24-bookworm-slim AS codecs
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates cmake ninja-build g++ && rm -rf /var/lib/apt/lists/*
COPY packages/image-import/native packages/image-import/native
COPY scripts/build-image-codecs.mjs scripts/build-image-codecs.mjs
RUN node scripts/build-image-codecs.mjs

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json .oxlintrc.json .gitignore ./
COPY apps apps
COPY packages packages
COPY --from=codecs /app/packages/image-import/native/build packages/image-import/native/build
COPY plugins plugins
COPY migrations migrations
COPY scripts scripts
COPY tests tests
COPY baseline baseline
COPY legacy/pure/static legacy/pure/static
COPY legacy/pure/agent/install.sh legacy/pure/agent/agent.tgz legacy/pure/agent/agent.tgz.sha256 legacy/pure/agent/
COPY legacy/pure/canvas/src/AssetPacks.tsx legacy/pure/canvas/src/asset-packs.css legacy/pure/canvas/src/flowPicker.ts legacy/pure/canvas/src/
RUN pnpm build && mkdir -m 700 /app/media && chown -R node:node /app/media /app/apps/web/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000 4000
CMD ["pnpm","start:api"]
