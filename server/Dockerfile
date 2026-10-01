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
COPY server ./server
RUN npm run build -w @gungi/server

FROM deps AS prod-deps
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/packages ./packages
COPY --from=build --chown=nestjs:nodejs /app/server/dist ./server/dist
USER nestjs
EXPOSE 4000
CMD ["node", "server/dist/main.js"]
