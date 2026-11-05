import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { renderMetrics } from '../metrics.js';
import type { Runner } from '../runner.js';
import { readBackups, readEvents, readLive, readReleases } from '../state.js';

export interface StageRow {
  n: string;
  state: 'available' | 'applied';
  title: string;
}

/** `stage.sh list` prints "NN state title" lines. */
export function parseStages(steps: readonly string[]): StageRow[] {
  const rows: StageRow[] = [];
  for (const line of steps) {
    const m = /^(\d{2}) (available|applied)\s+(.*)$/.exec(line);
    if (m?.[1] && m[2] && m[3] !== undefined) rows.push({ n: m[1], state: m[2] as StageRow['state'], title: m[3] });
  }
  return rows;
}

interface PromAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt?: string;
}
interface PromTarget {
  labels: Record<string, string>;
  health: string;
}

/** Read-only routes. Nothing here changes the server. */
export function registerCore(app: FastifyInstance, config: Config, run: Runner, fetchImpl: typeof fetch = fetch): void {
  app.get('/api/health', async () => ({ ok: true, lab: config.lab }));

  app.get('/api/overview', async () => ({
    environment: config.production ? 'production' : 'development',
    lab: config.lab,
    live: await readLive(config),
    releases: await readReleases(config),
    events: (await readEvents(config, 20)).reverse(),
  }));

  app.get('/api/deploys', async () => ({ events: (await readEvents(config, 100)).reverse() }));
  app.get('/api/backups', async () => ({ backups: await readBackups(config) }));

  app.get('/api/drift', async () => {
    const out = await run('drift.sh', ['check']);
    return { drifted: out.exitCode !== 0, files: Array.isArray(out.result?.detail) ? out.result.detail : [] };
  });

  app.get('/api/stages', async () => ({ stages: parseStages((await run('stage.sh', ['list'])).steps) }));

  // What Prometheus thinks, asked through this server so the page needs no second origin.
  app.get('/api/alerts', async () => {
    if (!config.prometheusUrl) return { available: false, alerts: [], targets: [] };
    try {
      const [alerts, targets] = await Promise.all([
        fetchImpl(`${config.prometheusUrl}/api/v1/alerts`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()),
        fetchImpl(`${config.prometheusUrl}/api/v1/targets`, { signal: AbortSignal.timeout(2000) }).then((r) =>
          r.json(),
        ),
      ]);
      const a = (alerts as { data: { alerts: PromAlert[] } }).data.alerts;
      const t = (targets as { data: { activeTargets: PromTarget[] } }).data.activeTargets;
      return {
        available: true,
        alerts: a.map((x) => ({
          name: x.labels.alertname ?? '',
          severity: x.labels.severity ?? '',
          state: x.state,
          since: x.activeAt ?? null,
          summary: x.annotations.summary ?? '',
        })),
        targets: t.map((x) => ({ job: x.labels.job ?? '', health: x.health })),
      };
    } catch {
      return { available: false, alerts: [], targets: [] };
    }
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return renderMetrics(config, run);
  });
}
