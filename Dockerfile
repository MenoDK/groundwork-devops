# syntax=docker/dockerfile:1.7

# ---- server: what a small VPS has, in one image: nginx, a database client, curl, jq, and a non-root user -----------------
FROM node:22-bookworm-slim AS server
# Versions come from the Debian release this image is pinned to; pinning each package by hand would only make it rot.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx postgresql-client curl jq tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --shell /usr/sbin/nologin gw \
 && mkdir -p /srv/groundwork /opt/groundwork \
 && chown gw:gw /srv/groundwork

# ---- ops: the scripts, the sample app, the releases it can ship, the configuration the repository owns -----------------
FROM server AS ops
COPY --chown=gw:gw ops /opt/groundwork/ops
COPY --chown=gw:gw app /opt/groundwork/app
COPY --chown=gw:gw releases-src /opt/groundwork/releases-src
COPY --chown=gw:gw nginx /opt/groundwork/nginx
COPY --chown=gw:gw desired /opt/groundwork/desired

# ---- ops-test: the same, plus bats and the tests ---------------------------------------------------------------------
FROM ops AS ops-test
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends bats && rm -rf /var/lib/apt/lists/*
COPY --chown=gw:gw test /opt/groundwork/test
USER gw
WORKDIR /opt/groundwork
CMD ["bats", "--print-output-on-failure", "test/ops"]

# ---- dependencies: the full tree, cached on the lockfile alone ------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: TypeScript to JavaScript -------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---- production dependencies only ---------------------------------------------------------------------------------------
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- runtime ----------------------------------------------------------------------------------------------------------
FROM ops AS runtime
ENV NODE_ENV=production GW_ROOT=/srv/groundwork GW_OPT=/opt/groundwork
COPY --from=prod-deps --chown=gw:gw /app/node_modules /opt/groundwork/node_modules
COPY --from=build --chown=gw:gw /app/dist /opt/groundwork/dist
COPY --chown=gw:gw package.json /opt/groundwork/package.json
COPY --chown=gw:gw site /opt/groundwork/site
USER 10001:10001
WORKDIR /opt/groundwork
EXPOSE 8080
# Asks through nginx, so a dead proxy and a dead API both turn the container unhealthy.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["curl", "-fsS", "http://127.0.0.1:8080/api/health"]
ENTRYPOINT ["tini", "--"]
CMD ["/opt/groundwork/ops/entrypoint.sh"]
