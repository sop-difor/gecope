FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# Sem fallback para `npm i`: se o package-lock.json sair de sincronia com o package.json o build
# deve FALHAR, em vez de instalar versões diferentes das testadas (revisão 08/10/2026).
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
# Roda como usuário não-root (a imagem base node:alpine já traz o usuário "node" pronto)
# em vez do root padrão do container.
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"
CMD ["node", "web/index.js"]
