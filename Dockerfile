FROM node:22-bookworm-slim

# FFmpeg + Chromium deps for Remotion server-side render
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    unzip \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Download Chrome headless for Remotion (cached in image)
RUN npx remotion browser ensure || true

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_PATH=/app/storage
ENV RENDERER=remotion
ENV REMOTION_CONCURRENCY=1

RUN mkdir -p /app/storage /app/data

EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
