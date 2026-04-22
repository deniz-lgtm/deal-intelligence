# ---- deps stage ----
FROM node:20-alpine AS deps
WORKDIR /app
# Skip puppeteer's bundled Chromium download — we use puppeteer-core
# with the system chromium installed in the runner stage.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json .npmrc ./
RUN npm ci

# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Only NEXT_PUBLIC vars must be present at build time (baked into client bundle).
# Sensitive runtime secrets are NOT needed here; Railway injects them at container start.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

RUN npm run build

# ---- runner stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# System Chromium for puppeteer-core. Alpine ships a native build that
# matches musl libc; we use puppeteer-core (no bundled Chrome) and point
# it at /usr/bin/chromium via PUPPETEER_EXECUTABLE_PATH so the image
# stays slim and we don't carry the unused Debian-glibc Chrome that
# full `puppeteer` would otherwise download.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto-emoji
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
