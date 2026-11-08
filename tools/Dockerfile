FROM node:20.19.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NODE_ENV=production PREVIEW_MODE=1 NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://peticao:peticao@127.0.0.1:1/peticao \
    HASH_PEPPER=QA-LAB-PEPPER-FICTITIOUS-NEVER-PRODUCTION-20261108 \
    ADMIN_PASSWORD=QA-LAB-ADMIN-NOT-PRODUCTION-20261108 \
    CPF_CACHE_ENCRYPTION_KEY=QA-LAB-CACHE-KEY-NOT-PRODUCTION-20261108 \
    MAIL_PROVIDER=dev MAIL_PROVIDERS=dev
RUN npm run build
USER node
CMD ["node","/lab/server.mjs"]
