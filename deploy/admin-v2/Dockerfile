# The runtime is produced and verified before building this image; no npm install here.
FROM node:20.19.2-bookworm-slim@sha256:ae5e29a169a6dbe7f45d552d73674001cc00913a0a8a5967c57a34f92e940ec8
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --chown=node:node runtime/ /app/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
# Host networking preserves access to existing loopback-only PostgreSQL without
# changing its listener. The application itself MUST remain loopback-only.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3001"]
