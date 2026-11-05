import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMetricsCache } from '../../src/metrics.js';
import { parseStages } from '../../src/routes/core.js';
import { LOCAL, harness, ok } from './helpers.js';

beforeEach(() => resetMetricsCache());

const get = (app: Awaited<ReturnType<typeof harness>>['app'], url: string) =>
  app.inject({ method: 'GET', url, headers: LOCAL });
const event = (gate: string, result: string) =>
  `${JSON.stringify({ ts: '2026-11-04T12:00:00Z', release: 'v1', gate, result, reason: '' })}\n`;

describe('what the server reports', () => {
  it('has a health endpoint that says whether the lab is on', async () => {
    const { app } = await harness({ GW_LAB: '0' });
    expect((await get(app, '/api/health')).json()).toEqual({ ok: true, lab: false });
  });

  it('shows no live release and an empty history on a fresh server', async () => {
    const { app } = await harness();
    expect((await get(app, '/api/overview')).json()).toMatchObject({
      live: null,
      releases: [],
      events: [],
      environment: 'development',
    });
  });

  it('lists the history newest first, and survives a torn line', async () => {
    const { app, root } = await harness();
    await appendFile(
      join(root, 'deploy-log.jsonl'),
      [event('all', 'shipped'), '{"ts": torn\n', event('unhealthy', 'refused')].join(''),
    );
    const events = (await get(app, '/api/deploys')).json().events as { gate: string }[];
    expect(events.map((e) => e.gate)).toEqual(['unhealthy', 'all']);
  });

  it('parses the stage list the script prints', () => {
    expect(
      parseStages([
        '01 available no root login',
        '02 applied  kernel settings',
        'noise',
        '03 available core dumps off',
      ]),
    ).toEqual([
      { n: '01', state: 'available', title: 'no root login' },
      { n: '02', state: 'applied', title: 'kernel settings' },
      { n: '03', state: 'available', title: 'core dumps off' },
    ]);
  });

  it('reports drift from the script, exit code and all', async () => {
    const { app } = await harness({}, () => ({
      exitCode: 1,
      steps: [],
      result: {
        ok: false,
        gate: 'drift',
        result: 'drifted',
        message: '1 file(s) differ',
        release: '',
        detail: [{ state: 'modified', path: 'a.conf' }],
      },
    }));
    expect((await get(app, '/api/drift')).json()).toEqual({
      drifted: true,
      files: [{ state: 'modified', path: 'a.conf' }],
    });
  });
});

describe('metrics', () => {
  it('counts deploys by outcome and ignores what other scripts logged', async () => {
    const { app, root } = await harness();
    await writeFile(
      join(root, 'deploy-log.jsonl'),
      event('all', 'shipped') +
        event('all', 'shipped') +
        event('unhealthy', 'refused') +
        event('rollback', 'rolled_back') +
        event('backup', 'shipped') +
        event('process', 'refused') +
        event('drill', 'refused'),
    );
    const text = (await get(app, '/metrics')).body;
    expect(text).toContain('gw_deploys_total{result="shipped"} 2');
    expect(text).toContain('gw_deploys_total{result="refused"} 1');
    expect(text).toContain('gw_deploys_total{result="rolled_back"} 1');
  });

  it('says whether the last restore drill held, and nothing at all before there has been one', async () => {
    const { app, root } = await harness();
    expect((await get(app, '/metrics')).body).not.toContain('gw_last_drill_ok');
    await writeFile(join(root, 'deploy-log.jsonl'), event('drill', 'shipped') + event('drill', 'refused'));
    expect((await get(app, '/metrics')).body).toContain('gw_last_drill_ok 0');
  });

  it('reports the age of the newest real backup, not of a damaged copy', async () => {
    const { app, root } = await harness();
    const dir = join(root, 'backups');
    await mkdir(dir, { recursive: true });
    for (const [name, at] of [
      ['db-20261104T100000Z.dump', '2026-11-04T10:00:00Z'],
      ['damaged-20261104T110000Z.dump', '2026-11-04T11:00:00Z'],
    ] as const) {
      await writeFile(join(dir, name), 'x');
      await writeFile(join(dir, `${name}.meta.json`), JSON.stringify({ taken_at: at, tables: {} }));
    }
    expect((await get(app, '/metrics')).body).toContain(
      `gw_last_backup_timestamp_seconds ${Date.parse('2026-11-04T10:00:00Z') / 1000}`,
    );
  });

  it('exports how many files differ from the repository', async () => {
    const { app } = await harness({}, () => ok('drift', { detail: [{}, {}] }));
    expect((await get(app, '/metrics')).body).toContain('gw_config_drift_files 2');
  });
});

describe('alerts', () => {
  it('says it is unavailable when no Prometheus is configured', async () => {
    const { app } = await harness();
    expect((await get(app, '/api/alerts')).json()).toEqual({ available: false, alerts: [], targets: [] });
  });

  it('turns what Prometheus says into a short list', async () => {
    const root = await harness({ GW_PROMETHEUS_URL: 'http://prom.test:9090' });
    const { buildApp } = await import('../../src/app.js');
    const fetchImpl = (async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith('/alerts')
            ? {
                data: {
                  alerts: [
                    {
                      labels: { alertname: 'AppDown', severity: 'page' },
                      annotations: { summary: 'down' },
                      state: 'firing',
                      activeAt: 't',
                    },
                  ],
                },
              }
            : { data: { activeTargets: [{ labels: { job: 'app' }, health: 'down' }] } },
        ),
      )) as unknown as typeof fetch;
    const app = await buildApp(root.config, { runner: async () => ok(), fetchImpl });
    expect((await get(app, '/api/alerts')).json()).toEqual({
      available: true,
      alerts: [{ name: 'AppDown', severity: 'page', state: 'firing', since: 't', summary: 'down' }],
      targets: [{ job: 'app', health: 'down' }],
    });
  });

  it('says it is unavailable, instead of failing, when Prometheus does not answer', async () => {
    const root = await harness({ GW_PROMETHEUS_URL: 'http://prom.test:9090' });
    const { buildApp } = await import('../../src/app.js');
    const app = await buildApp(root.config, {
      runner: async () => ok(),
      fetchImpl: (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    });
    expect((await get(app, '/api/alerts')).json().available).toBe(false);
  });
});
