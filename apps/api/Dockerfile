# ProGüzellik API — üretim imajı (çok aşamalı). Monorepo kökünden derleyin:
#   docker build -f apps/api/Dockerfile -t proguzellik-api .
FROM node:20-bookworm-slim AS build
WORKDIR /repo
# openssl: Prisma doğru motoru (debian-openssl-3.0.x) seçsin
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @proguzellik/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @proguzellik/api exec prisma generate && pnpm --filter @proguzellik/api build
RUN pnpm --filter @proguzellik/api deploy --prod /out && cp -r apps/api/dist apps/api/prisma /out/

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out ./
# Prisma CLI sabit sürümle bağımlılıklarda; derleme ağdan rastgele sürüm indirmez.
RUN node_modules/.bin/prisma generate --schema prisma/schema.prisma && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Normal başlangıç migration ÇALIŞTIRMAZ. Migration ayrı, tek seferlik komutla:
#   docker compose run --rm migrate              (node dist/cli/migrate.js deploy --confirm)
# İlk platform sahibi:  docker compose run --rm -it api node dist/cli/create-owner.js --email ... --name "..."
CMD ["node", "dist/main.js"]
