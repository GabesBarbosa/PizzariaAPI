# Stage 1: build
FROM node:18-bookworm AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:18-bookworm-slim AS runtime

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

ENV NODE_ENV=production

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
