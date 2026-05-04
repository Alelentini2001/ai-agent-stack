FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S gate && adduser -S gate -G gate
COPY package.json ./
RUN npm install --omit=dev --frozen-lockfile
COPY --from=builder /app/dist ./dist
RUN mkdir -p data && chown -R gate:gate .
USER gate
EXPOSE 4242
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4242/healthz || exit 1
CMD ["node", "dist/index.js"]
