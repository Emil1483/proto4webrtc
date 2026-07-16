# glibc base — mediasoup ships a prebuilt native worker for glibc only.
# (Alpine/musl would have to compile the worker: python3/make/g++/linux-headers.)
FROM node:22-bookworm-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
# `npm ci` runs the `prepare` script (next-ws patch) and downloads the
# prebuilt mediasoup worker binary.
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output already includes the traced mediasoup worker binary
# (see next.config.ts outputFileTracingIncludes).
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

CMD ["node", "server.js"]
