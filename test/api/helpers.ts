import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { type Config, loadConfig } from '../../src/config.js';
import type { Outcome, Runner } from '../../src/runner.js';

export interface Call {
  script: string;
  args: string[];
}

export const ok = (message = 'fine', extra: Partial<Outcome['result'] & object> = {}): Outcome => ({
  exitCode: 0,
  steps: ['==> step one', 'ok step two'],
  result: { ok: true, gate: 'all', result: 'shipped', message, release: 'v1', detail: null, ...extra },
});

export async function harness(env: Record<string, string> = {}, answer: (c: Call) => Outcome = () => ok()) {
  const root = await mkdtemp(join(tmpdir(), 'gw-api-'));
  await mkdir(join(root, 'shared'), { recursive: true });
  await writeFile(join(root, 'shared', 'app.env'), 'DATABASE_URL=x\n', { mode: 0o600 });
  const site = join(root, 'site');
  await mkdir(site);
  await writeFile(join(site, 'index.html'), '<!doctype html><title>t</title>');
  const config: Config = loadConfig({ GW_ROOT: root, GW_OPT: root, GW_SITE_DIR: site, GW_LAB: '1', ...env });
  const calls: Call[] = [];
  const runner: Runner = async (script, args) => {
    const call = { script, args: [...args] };
    calls.push(call);
    return answer(call);
  };
  const app: FastifyInstance = await buildApp(config, { runner });
  return { app, calls, root, config };
}

export const LOCAL = { host: 'localhost:8100' };
