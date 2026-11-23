FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq5 postgresql-client chromium fonts-liberation nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --upgrade 'pip>=26.2' \
    && pip install --no-cache-dir -r /app/requirements.txt

COPY backend/app /app/app
# Starlette requires the mounted static root to exist even when a deployment
# does not ship any evidence/branding assets.
RUN mkdir -p /app/app/static
COPY backend/alembic /app/alembic
COPY backend/alembic.ini /app/alembic.ini
COPY backend/seed_admin.py /app/seed_admin.py
COPY backend/reset_user_password.py /app/reset_user_password.py
COPY backend/seed_demo_showcase.py /app/seed_demo_showcase.py
COPY backend/entrypoint.sh /app/entrypoint.sh
RUN mkdir -p /opt/treseko/automation-worker-source
COPY automation-worker/package.json automation-worker/package-lock.json automation-worker/.npmrc automation-worker/VERSION automation-worker/entrypoint.sh automation-worker/worker-launcher.mjs automation-worker/Dockerfile automation-worker/README.md automation-worker/hash_component_tree.sh /opt/treseko/automation-worker-source/
COPY automation-worker/src/ /opt/treseko/automation-worker-source/src/
COPY automation-worker/vendor/ /opt/treseko/automation-worker-source/vendor/
COPY automation-worker/hash_component_tree.sh /usr/local/bin/treseko-hash-component-tree
RUN mkdir -p /opt/treseko/engine-source
COPY engine/package.json engine/package-lock.json engine/VERSION engine/tsconfig.json engine/hash_component_tree.sh engine/entrypoint.sh engine/Dockerfile engine/engine-launcher.mjs engine/release-lifecycle.mjs engine/engine-self-update.mjs engine/engine-self-update.d.mts /opt/treseko/engine-source/
COPY engine/src/ /opt/treseko/engine-source/src/
RUN /usr/local/bin/treseko-hash-component-tree /opt/treseko/engine-source \
       > /opt/treseko/engine-source/.treseko-content-digest
COPY VERSION /VERSION
RUN chmod +x /app/entrypoint.sh /usr/local/bin/treseko-hash-component-tree \
    && /usr/local/bin/treseko-hash-component-tree /opt/treseko/automation-worker-source \
       > /opt/treseko/automation-worker-source/.treseko-content-digest

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read()" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
