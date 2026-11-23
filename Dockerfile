# X Document Manager — single-container deployment.
# Everything (documents, database, eCourts memory) lives under DATA_DIR, so mount
# a persistent volume there and the app survives restarts and redeploys.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data && useradd -ms /bin/bash app && chown -R app:app /data /app
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "src/server.js"]
