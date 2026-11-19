FROM node:24-bookworm-slim AS codecs
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates cmake ninja-build g++ && rm -rf /var/lib/apt/lists/*
COPY packages/image-import/native packages/image-import/native
COPY scripts/build-image-codecs.mjs scripts/build-image-codecs.mjs
RUN node scripts/build-image-codecs.mjs

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS development
COPY --from=codecs /app/packages/image-import/native/build packages/image-import/native/build
RUN mkdir -p /app/media /app/apps/web/.next && chmod 700 /app/media && chown -R node:node /app/media /app/apps/web
USER node

FROM dependencies AS build
COPY tsconfig.json ./
COPY apps apps
COPY packages packages
COPY --from=codecs /app/packages/image-import/native/build packages/image-import/native/build
COPY plugins plugins
COPY migrations migrations
COPY scripts scripts
COPY tests tests
COPY baseline/production/manifest.json baseline/production/manifest.json
COPY baseline/production/static baseline/production/static
RUN pnpm build

FROM dependencies AS runtime
COPY tsconfig.json ./
COPY --from=build /app/apps apps
COPY --from=build /app/packages packages
COPY --from=build /app/plugins plugins
COPY --from=build /app/migrations migrations
COPY --from=build /app/baseline baseline
COPY scripts/migrate.ts scripts/bootstrap.ts scripts/import-legacy.ts scripts/dev-studio.ts scripts/
RUN mkdir -m 700 /app/media && chown -R node:node /app/media /app/apps/web/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000 4000
CMD ["pnpm","start:api"]
