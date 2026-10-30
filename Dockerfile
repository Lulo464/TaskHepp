# Tasklog: API server + admin UI in one image.

FROM node:24-alpine AS admin
WORKDIR /build/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:24-alpine AS server
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
RUN mkdir -p /uploads && chown node:node /uploads
ENV UPLOAD_DIR=/uploads
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/index.js"]
