# syntax=docker/dockerfile:1
# Despawn relay + owner app + shop viewer in one small image.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @despawn/viewer build \
 && pnpm --filter @despawn/owner build \
 && pnpm --filter @despawn/adapter-node build

FROM node:22-alpine
WORKDIR /srv
RUN addgroup -S despawn && adduser -S despawn -G despawn \
 && mkdir -p /data/blobs && chown -R despawn:despawn /data
COPY --from=build /app/adapters/node/dist/main.mjs ./main.mjs
COPY --from=build /app/apps/owner/dist ./owner
COPY --from=build /app/apps/viewer/dist ./viewer
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    OWNER_DIST=/srv/owner \
    VIEWER_DIST=/srv/viewer \
    BLOB_DIR=/data/blobs
USER despawn
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/v1/health || exit 1
CMD ["node", "main.mjs"]
