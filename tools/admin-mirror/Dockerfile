FROM node:20.19.2-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ADMIN_MIRROR_BUILD=1
COPY site/package.json site/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY site/tsconfig.json site/next-env.d.ts site/next.config.mjs ./
COPY site/src ./src
COPY site/public ./public
COPY site/assets ./assets
RUN HASH_PEPPER=build-only-fictitious DATA_ENCRYPTION_KEY=build-only-fictitious npm run build

FROM node:20.19.2-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PREVIEW_MODE=1 ADMIN_NO_PASSWORD=1 ADMIN_MIRROR_MODE=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.mjs ./
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
COPY tools/admin-mirror/gateway.py tools/admin-mirror/entrypoint.py /opt/admin-mirror/
USER 1000:1000
EXPOSE 3031
CMD ["python3", "/opt/admin-mirror/entrypoint.py"]
