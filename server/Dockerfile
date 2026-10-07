FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV TMP_ROOT=/app/tmp/jobs
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm install --no-audit --no-fund

COPY server/ ./server/
COPY client/ ./client/
RUN npm run build:server

RUN mkdir -p /app/tmp/jobs && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
