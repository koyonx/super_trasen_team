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
COPY client ./client
RUN pnpm --filter @gungi/client build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/client/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/client/.next/static ./client/.next/static
COPY --from=build --chown=nextjs:nodejs /app/client/public ./client/public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "client/server.js"]
