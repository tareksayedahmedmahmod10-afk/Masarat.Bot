FROM ghcr.io/puppeteer/puppeteer:22

USER root

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app
RUN chown -R pptruser:pptruser /app

COPY package*.json ./
RUN npm install

COPY . .

USER pptruser

CMD ["node", "server.js"]