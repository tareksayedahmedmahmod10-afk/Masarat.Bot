FROM ghcr.io/puppeteer/puppeteer:22

USER root

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# إنشاء مجلد الـ auth بصلاحيات صح
RUN mkdir -p /app/.wwebjs_auth && \
    chown -R pptruser:pptruser /app

COPY package*.json ./
RUN npm install

COPY . .

RUN chown -R pptruser:pptruser /app

USER pptruser

CMD ["node", "server.js"]