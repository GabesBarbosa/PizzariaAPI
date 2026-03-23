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

# Instala Chromium (apt resolve as dependências automaticamente)
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia artefatos do build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
# Cria pasta de sessão do whatsapp-web.js e garante permissão
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app/.wwebjs_auth

ENV NODE_ENV=production
# Se quiser forçar o caminho do Chromium (opcional)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]