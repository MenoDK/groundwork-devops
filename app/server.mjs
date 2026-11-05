// @ts-check
// The sample service every release ships. It does almost nothing on purpose: the project is about getting it onto the
// server safely, so the only behaviour that matters is that it can be healthy or not, and says which release it is.
//
// What a release changes is its release.json (name, version, where it believes the database is). A release whose
// configuration points at the wrong database port is the most common reason a "green" build is not a working one.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, version: string, db: { port: number } }} Release */

const here = dirname(fileURLToPath(import.meta.url));
/** @type {Release} */
const release = JSON.parse(readFileSync(join(here, '..', 'release.json'), 'utf8'));
const port = Number(process.env.PORT ?? 0);
const dbHost = process.env.GW_DB_HOST ?? 'db';
// Loopback by default: on the VPS only nginx reaches it. A container sets GW_BIND=0.0.0.0 so its probes can.
const bind = process.env.GW_BIND ?? '127.0.0.1';
const startedAt = Date.now();
let requests = 0;

/** @param {string} host @param {number} dbPort @returns {Promise<boolean>} */
function reachable(host, dbPort) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: dbPort, timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

const server = createServer(async (req, res) => {
  requests += 1;
  const path = (req.url ?? '/').split('?')[0];
  /** @param {number} status @param {unknown} body */
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  if (path === '/healthz') {
    const up = await reachable(dbHost, release.db.port);
    return up
      ? json(200, { ok: true, release: release.name, version: release.version })
      : json(503, {
          ok: false,
          release: release.name,
          version: release.version,
          reason: `database unreachable at ${dbHost}:${release.db.port}`,
        });
  }
  if (path === '/version') return json(200, { release: release.name, version: release.version });
  if (path === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    return res.end(
      [
        '# TYPE app_info gauge',
        `app_info{release="${release.name}",version="${release.version}"} 1`,
        '# TYPE app_requests_total counter',
        `app_requests_total ${requests}`,
        '# TYPE app_uptime_seconds gauge',
        `app_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
        '',
      ].join('\n'),
    );
  }
  if (path === '/') return json(200, { service: 'sample', release: release.name, version: release.version });
  return json(404, { error: 'not_found' });
});

server.listen(port, bind);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
