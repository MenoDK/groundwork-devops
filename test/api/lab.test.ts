import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL, harness, ok } from './helpers.js';

const post = (app: Awaited<ReturnType<typeof harness>>['app'], url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, headers: LOCAL, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('the lab', () => {
  it('does not exist unless it is switched on', async () => {
    const { app, calls } = await harness({ GW_LAB: '0' });
    const res = await post(app, '/api/lab/ship', { variant: 'v1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'lab_disabled' });
    expect(calls).toHaveLength(0);
  });

  it('builds an artifact, then ships the directory it was built into', async () => {
    const { app, calls, root } = await harness({}, (c) =>
      c.script === 'build-release.sh' ? { exitCode: 0, steps: [], result: null } : ok('v2 is serving'),
    );
    const res = await post(app, '/api/lab/ship', { variant: 'v2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, gate: 'all', result: 'shipped', message: 'v2 is serving' });
    expect(calls.map((c) => c.script)).toEqual(['build-release.sh', 'deploy.sh']);
    expect(calls[1]?.args).toEqual([join(root, 'artifacts', 'v2')]);
  });

  it('passes the tamper request to the build, never to the deploy', async () => {
    const { app, calls } = await harness();
    await post(app, '/api/lab/ship', { variant: 'v1', tamper: 'edit' });
    expect(calls[0]?.args.slice(-2)).toEqual(['--tamper', 'edit']);
    expect(calls[1]?.args.some((a) => a.includes('tamper'))).toBe(false);
  });

  it('reports a refusal with its gate and the exit code, as data and not as an error', async () => {
    const { app } = await harness({}, (c) =>
      c.script === 'deploy.sh'
        ? {
            exitCode: 13,
            steps: ['x unhealthy: no answer'],
            result: {
              ok: false,
              gate: 'unhealthy',
              result: 'refused',
              message: 'no answer',
              release: 'v3-no-database',
              detail: null,
            },
          }
        : { exitCode: 0, steps: [], result: null },
    );
    const res = await post(app, '/api/lab/ship', { variant: 'v3-no-database' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, exitCode: 13, gate: 'unhealthy', result: 'refused' });
  });

  it('refuses a variant it does not ship, and any field it does not know', async () => {
    const { app, calls } = await harness();
    expect((await post(app, '/api/lab/ship', { variant: '../../etc/passwd' })).statusCode).toBe(400);
    expect((await post(app, '/api/lab/ship', { variant: 'v1', command: 'rm -rf /' })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses a backup name that is not one the scripts wrote', async () => {
    const { app, calls } = await harness();
    for (const file of ['../backups/db-x.dump', 'db-20261104T120000Z.dump; id', '/etc/passwd', 'db-1.dump']) {
      expect((await post(app, '/api/lab/backups/drill', { file })).statusCode, file).toBe(400);
    }
    expect(calls).toHaveLength(0);
    const good = await post(app, '/api/lab/backups/drill', { file: 'db-20261104T120000Z.dump' });
    expect(good.statusCode).toBe(200);
    expect(calls[0]?.args[0]).toBe('drill');
  });

  it('keeps rotate within a sensible range', async () => {
    const { app } = await harness();
    expect((await post(app, '/api/lab/backups/rotate', { keep: 0 })).statusCode).toBe(400);
    expect((await post(app, '/api/lab/backups/rotate', { keep: 21 })).statusCode).toBe(400);
    expect((await post(app, '/api/lab/backups/rotate', { keep: 2 })).statusCode).toBe(200);
  });

  it('damages a copy of a backup and leaves the backup alone', async () => {
    const { app, root } = await harness();
    const dir = join(root, 'backups');
    await mkdir(dir, { recursive: true });
    const original = Buffer.alloc(64, 0x41);
    await writeFile(join(dir, 'db-20261104T120000Z.dump'), original);
    await writeFile(join(dir, 'db-20261104T120000Z.dump.sha256'), 'abc  db-20261104T120000Z.dump\n');
    const res = await post(app, '/api/lab/backups/damage', { file: 'db-20261104T120000Z.dump' });
    expect(res.json()).toEqual({ ok: true, file: 'damaged-20261104T120000Z.dump' });
    expect(await readFile(join(dir, 'db-20261104T120000Z.dump'))).toEqual(original);
    const copy = await readFile(join(dir, 'damaged-20261104T120000Z.dump'));
    expect(copy[32]).toBe(0xff);
    expect(copy.filter((b) => b !== 0x41)).toHaveLength(1);
  });

  it('only damages a real backup, not an arbitrary file', async () => {
    const { app } = await harness();
    expect((await post(app, '/api/lab/backups/damage', { file: 'damaged-20261104T120000Z.dump' })).statusCode).toBe(
      400,
    );
    expect((await post(app, '/api/lab/backups/damage', { file: '../../etc/passwd' })).statusCode).toBe(400);
  });

  it('loosens and tightens the secrets file only to the two modes it knows', async () => {
    const { app, root } = await harness();
    await post(app, '/api/lab/env-mode', { mode: '644' });
    expect(((await stat(join(root, 'shared', 'app.env'))).mode & 0o777).toString(8)).toBe('644');
    await post(app, '/api/lab/env-mode', { mode: '600' });
    expect(((await stat(join(root, 'shared', 'app.env'))).mode & 0o777).toString(8)).toBe('600');
    expect((await post(app, '/api/lab/env-mode', { mode: '777' })).statusCode).toBe(400);
  });

  it('edits only the two files the repository owns, in the live copy', async () => {
    const { app, root } = await harness();
    const live = join(root, 'live-config');
    await mkdir(join(live, 'systemd'), { recursive: true });
    await writeFile(join(live, 'systemd', 'groundwork-backup.timer'), '[Timer]\n');
    expect(
      (await post(app, '/api/lab/drift/edit', { file: 'systemd/groundwork-backup.timer', kind: 'edit' })).statusCode,
    ).toBe(200);
    expect(await readFile(join(live, 'systemd', 'groundwork-backup.timer'), 'utf8')).toContain('fixed by hand');
    expect((await post(app, '/api/lab/drift/edit', { file: '../../etc/passwd', kind: 'edit' })).statusCode).toBe(400);
  });

  it('applies and reverts stages by number, and "all" becomes the flag the script takes', async () => {
    const { app, calls } = await harness();
    await post(app, '/api/lab/stages/apply', { n: '02' });
    await post(app, '/api/lab/stages/revert', { n: 'all' });
    expect(calls.map((c) => c.args)).toEqual([
      ['apply', '02'],
      ['revert', '--all'],
    ]);
    expect((await post(app, '/api/lab/stages/apply', { n: '99' })).statusCode).toBe(400);
  });

  it('refuses a body that is too large', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/lab/ship',
      headers: { ...LOCAL, 'content-type': 'application/json' },
      payload: JSON.stringify({ variant: 'v1', pad: 'x'.repeat(70_000) }),
    });
    expect(res.statusCode).toBe(413);
  });
});
