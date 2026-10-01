# Build context: repository root (see docker-compose.yml)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/gungi-engine/package.json ./packages/gungi-engine/
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY client ./client
RUN npm run build -w @gungi/client

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
