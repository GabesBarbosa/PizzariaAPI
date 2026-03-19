# Stage 1: build
FROM node:18-bullseye AS builder
WORKDIR /app

# Copia package.json e package-lock e instala dependências (inclui dev)
COPY package*.json ./
RUN npm ci

# Copia o restante e compila TypeScript
COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:18-bullseye-slim AS runtime

# Instala dependências necessárias para Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libatk-1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia artefatos do build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/.wwebjs_auth ./ .wwebjs_auth || true

# Cria pasta de sessão do whatsapp-web.js e garante permissão
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app/.wwebjs_auth

ENV NODE_ENV=production
# Se quiser forçar o caminho do Chromium (opcional)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]