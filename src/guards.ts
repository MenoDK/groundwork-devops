import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

/**
 * Two checks that keep a web page from driving this server, and neither is authentication:
 *  - the Host header must be a name we answer to (a rebinding attack arrives with the attacker's name);
 *  - a request that changes something must come from this origin, or from no browser at all.
 */
export function installGuards(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!config.allowedHosts.has(host)) {
      return reply.status(403).send({ error: 'host_not_allowed' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin !== undefined) {
        let originHost = '';
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          // an Origin that is not a URL ("null", for example) is never ours
        }
        if (originHost !== (request.headers.host ?? '').toLowerCase()) {
          return reply.status(403).send({ error: 'origin_not_allowed' });
        }
      }
      if (request.headers['sec-fetch-site'] === 'cross-site') {
        return reply.status(403).send({ error: 'origin_not_allowed' });
      }
    }
  });
}
