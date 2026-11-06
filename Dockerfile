# Tasklog: API server + admin UI in one image.

# The build stages produce plain JavaScript (no native modules), so they run on the build machine's own platform
# even when the image is for another one (arm64 for a Raspberry Pi): fast, without emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS admin
WORKDIR /build/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:24-alpine AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    ADMIN_DIST=/app/admin
WORKDIR /app/server
COPY --from=server /build/server/package.json ./
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY --from=server /build/server/migrations ./migrations
COPY --from=admin /build/admin/dist /app/admin
# Photos attached to tickets; a named volume on /uploads keeps them (and takes over this owner).
# npm, corepack and yarn are only needed to build; without them the image is smaller and carries none of their
# vulnerabilities (the server runs with plain `node`).
RUN mkdir -p /uploads && chown node:node /uploads \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV UPLOAD_DIR=/uploads
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/index.js"]
