# syntax=docker/dockerfile:1
# The build stage runs on the build host's architecture: the output is plain JavaScript and the
# runtime dependencies (hono, ical.js, zod) have no native code, so they work on every platform.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@12.16.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json vite.config.ts ./
COPY src src
COPY web web
RUN pnpm run build && pnpm prune --prod

FROM node:26-alpine
ENV NODE_ENV=production PORT=4321 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4321/health || exit 1
CMD ["node", "dist/server/main.js"]
