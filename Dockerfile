# Stage 1: build
FROM node:18-bookworm AS builder
WORKDIR /app

# Copia package.json e package-lock e instala dependências (inclui dev)
COPY package*.json ./
RUN npm ci

# Copia o restante e compila TypeScript
COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:18-bookworm-slim AS runtime

# Instala Chromium, curl e dependências necessárias
RUN apt-get update && apt-get install -y \
    chromium \
    curl \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia artefatos do build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Pré-baixa o HTML do WhatsApp Web na imagem para evitar download na inicialização
# (webVersionCache: local — o arquivo fica em /app/wwebjs_cache/<versão>.html)
# Fonte: mesmo CDN usado pelo whatsapp-web.js quando type='remote'
RUN mkdir -p /app/wwebjs_cache && \
    curl -sSL \
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html" \
      -o /app/wwebjs_cache/2.2412.54.html \
      || echo "[Dockerfile] Aviso: falha ao pré-baixar WA HTML, será baixado no boot" && \
    chown -R node:node /app/wwebjs_cache

# Cria pasta de sessão do whatsapp-web.js e garante permissão
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app/.wwebjs_auth

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WWEBJS_CACHE_PATH=/app/wwebjs_cache

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]