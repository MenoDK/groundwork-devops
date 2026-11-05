# syntax=docker/dockerfile:1.7
# The sample service on its own, for the Helm chart. (On the VPS the same file ships inside a release artifact instead.)
FROM node:22-bookworm-slim
WORKDIR /srv/app
COPY app/server.mjs ./app/server.mjs
# The release the image carries: name, version, and where it believes the database is.
COPY releases-src/v2/release.json ./release.json
USER 10001:10001
ENV PORT=4101 GW_BIND=0.0.0.0
EXPOSE 4101
HEALTHCHECK --interval=5s --timeout=3s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "app/server.mjs"]
