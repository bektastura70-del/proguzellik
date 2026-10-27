# ProGüzellik web — üretim imajı. Monorepo kökünden: docker build -f apps/web/Dockerfile -t proguzellik-web .
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @proguzellik/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @proguzellik/web build && pnpm --filter @proguzellik/web deploy --prod /out && cp -r apps/web/.next apps/web/public apps/web/next.config.mjs /out/

FROM node:20-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# npx kullanılmaz (çalışma anında ağ erişimi/kurulum denemesi olmasın)
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
