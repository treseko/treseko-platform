FROM node:22-bookworm-slim AS runtime

WORKDIR /engine

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ARG OPENCODE_VERSION=1.18.5
ENV OPENCODE_VERSION=${OPENCODE_VERSION}
# Installed as a pinned, non-privileged runtime dependency. Deployments may
# override the ARG only after validating the corresponding release checksum.
RUN useradd --create-home --uid 10001 treseko-engine

# Install OpenCode through the official installer, then expose the pinned
# binary system-wide for the unprivileged Engine user.
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION}" \
    && install -m 0755 /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && test "$(opencode --version)" = "${OPENCODE_VERSION}"

ENV OPENCODE_BIN=/usr/local/bin/opencode \
    OPENCODE_WORKDIR=/tmp/treseko-opencode \
    XDG_CONFIG_HOME=/tmp/treseko-opencode/config \
    XDG_DATA_HOME=/tmp/treseko-opencode/data

RUN mkdir -p /tmp/treseko-opencode/config /tmp/treseko-opencode/data /engine \
    && chown -R treseko-engine:treseko-engine /tmp/treseko-opencode /engine

COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
COPY . /opt/treseko/engine-source
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]

# The entrypoint reads the Docker secret as root and immediately drops to the
# dedicated runtime UID before starting Node. Local Compose file secrets keep
# their host file mode, which can be 0600.
USER root
