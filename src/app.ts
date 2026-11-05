import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { installGuards } from './guards.js';
import { registerCore } from './routes/core.js';
import { registerLab } from './routes/lab.js';
import { type Runner, shellRunner } from './runner.js';

/** The page's scripts and styles are all same-origin files: nothing inline, nothing from elsewhere. */
export const SITE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export interface AppOverrides {
  runner?: Runner;
  fetchImpl?: typeof fetch;
  logger?: boolean;
}

export async function buildApp(config: Config, overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const run = overrides.runner ?? shellRunner(config);
  const app = Fastify({ logger: overrides.logger ?? false, bodyLimit: 64 * 1024, trustProxy: false });

  installGuards(app, config);
  app.addHook('onSend', async (request, reply) => {
    if (!request.url.startsWith('/api/') && request.url !== '/metrics')
      reply.header('content-security-policy', SITE_CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  registerCore(app, config, run, overrides.fetchImpl);
  registerLab(app, config, run);
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), config.siteDir),
    index: ['index.html'],
    wildcard: false,
  });
  return app;
}
