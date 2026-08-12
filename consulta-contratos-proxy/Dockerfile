# Imagem oficial do Playwright: já vem com Chromium + todas as libs de sistema
# necessárias para rodar headless em container (evita o clássico "missing shared libraries").
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
