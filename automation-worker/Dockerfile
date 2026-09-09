FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CYPRESS_CACHE_FOLDER=/ms-cypress \
    PUPPETEER_CACHE_DIR=/ms-puppeteer

ARG TRESEKO_WORKER_BROWSERS="chromium firefox webkit"
ARG TRESEKO_WORKER_INSTALL_CYPRESS="true"
ARG TRESEKO_WORKER_INSTALL_PUPPETEER="true"

WORKDIR /worker

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install every runtime explicitly once. The package postinstall hooks are
# disabled so they cannot download a duplicate browser during npm ci.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CYPRESS_INSTALL_BINARY=0 PUPPETEER_SKIP_DOWNLOAD=1 npm ci \
    && npx playwright install --with-deps ${TRESEKO_WORKER_BROWSERS} \
    && if [ "${TRESEKO_WORKER_INSTALL_CYPRESS}" = "true" ]; then npx cypress install; fi \
    && if [ "${TRESEKO_WORKER_INSTALL_PUPPETEER}" = "true" ]; then node node_modules/puppeteer/install.mjs; fi
COPY . .
COPY . /opt/treseko/worker-source
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
