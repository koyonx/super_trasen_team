# Build context: repository root (see docker-compose.yml)
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/gungi-engine/package.json ./packages/gungi-engine/
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY server ./server
RUN pnpm --filter @gungi/server build

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/gungi-engine/package.json ./packages/gungi-engine/
RUN pnpm install --no-frozen-lockfile --prod

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/server/node_modules ./server/node_modules
COPY --from=build --chown=nestjs:nodejs /app/server/dist ./server/dist
COPY --from=build --chown=nestjs:nodejs /app/packages ./packages
USER nestjs
EXPOSE 4000
CMD ["node", "server/dist/main.js"]
