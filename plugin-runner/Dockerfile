FROM node:22-alpine
ARG TRESEKO_RELEASE_VERSION=unknown
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN printf '%s\n' "$TRESEKO_RELEASE_VERSION" > /TRESEKO_RELEASE_VERSION
RUN addgroup -S runner && adduser -S runner -G runner && chown -R runner:runner /app
USER runner
ENV NODE_ENV=production
EXPOSE 3020
CMD ["node", "src/server.mjs"]
