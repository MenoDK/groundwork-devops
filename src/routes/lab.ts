import { appendFile, chmod, copyFile, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Outcome, Runner } from '../runner.js';
import { BACKUP_FILE } from '../state.js';

export const VARIANTS = ['v1', 'v2', 'v3-no-database', 'v4-orders-status', 'v5-bad-edge-config'] as const;
const variant = z.enum(VARIANTS);
const DRIFT_FILES = ['systemd/groundwork-backup.timer', 'nginx/security-headers.conf'] as const;

/** One shape for every answer: what the script said, and the steps it printed on the way. */
function shape(o: Outcome) {
  return {
    ok: o.result?.ok ?? o.exitCode === 0,
    exitCode: o.exitCode,
    gate: o.result?.gate ?? null,
    result: o.result?.result ?? null,
    message: o.result?.message ?? o.steps.at(-1) ?? '',
    release: o.result?.release ?? '',
    detail: o.result?.detail ?? null,
    steps: o.steps,
  };
}

/**
 * Everything that changes the server lives under /api/lab and answers 404 unless the lab is on. The lab has no login on
 * purpose (it is for a laptop), so the configuration refuses to start it in production, and the guards refuse a page
 * on any other origin.
 */
export function registerLab(app: FastifyInstance, config: Config, run: Runner): void {
  app.register(
    async (lab) => {
      lab.addHook('onRequest', async (_request, reply) => {
        if (!config.lab) return reply.status(404).send({ error: 'lab_disabled' });
      });

      const parse = <T extends z.ZodTypeAny>(
        schema: T,
        request: FastifyRequest,
        reply: FastifyReply,
      ): z.infer<T> | null => {
        const parsed = schema.safeParse(request.body ?? {});
        if (parsed.success) return parsed.data;
        reply
          .status(400)
          .send({ error: 'bad_request', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
        return null;
      };

      /** Builds an artifact from a variant (optionally tampered with) and returns its directory, or the failure. */
      const build = async (
        v: (typeof VARIANTS)[number],
        tamper?: 'edit' | 'add',
      ): Promise<{ dir: string } | { failure: Outcome }> => {
        const out = join(config.root, 'artifacts', v);
        const built = await run('build-release.sh', [v, out, ...(tamper ? ['--tamper', tamper] : [])]);
        return built.exitCode === 0 ? { dir: out } : { failure: built };
      };

      // --- ship -----------------------------------------------------------------------------------------------------
      lab.post('/ship', async (request, reply) => {
        const body = parse(z.object({ variant, tamper: z.enum(['edit', 'add']).optional() }).strict(), request, reply);
        if (!body) return;
        const built = await build(body.variant, body.tamper);
        if ('failure' in built) return shape(built.failure);
        return shape(await run('deploy.sh', [built.dir]));
      });
      lab.post('/rollback', async () => shape(await run('deploy.sh', ['--rollback'])));
      lab.post('/migrate', async (request, reply) => {
        const body = parse(z.object({ variant }).strict(), request, reply);
        if (!body) return;
        const built = await build(body.variant);
        if ('failure' in built) return shape(built.failure);
        return shape(await run('migrate.sh', [built.dir, '--apply']));
      });
      lab.post('/env-mode', async (request, reply) => {
        const body = parse(z.object({ mode: z.enum(['600', '644']) }).strict(), request, reply);
        if (!body) return;
        await chmod(join(config.root, 'shared', 'app.env'), Number.parseInt(body.mode, 8));
        return { ok: true, mode: body.mode };
      });
      lab.post('/app', async (request, reply) => {
        const body = parse(z.object({ action: z.enum(['stop', 'start']) }).strict(), request, reply);
        if (!body) return;
        return shape(await run('app-ctl.sh', [body.action]));
      });

      // --- backups --------------------------------------------------------------------------------------------------
      lab.post('/backups/take', async () => shape(await run('backup.sh', ['take'])));
      lab.post('/backups/drill', async (request, reply) => {
        const body = parse(z.object({ file: z.string().regex(BACKUP_FILE) }).strict(), request, reply);
        if (!body) return;
        return shape(await run('backup.sh', ['drill', join(config.root, 'backups', body.file)]));
      });
      lab.post('/backups/rotate', async (request, reply) => {
        const body = parse(z.object({ keep: z.number().int().min(1).max(20) }).strict(), request, reply);
        if (!body) return;
        return shape(await run('backup.sh', ['rotate', String(body.keep)]));
      });
      // Damages a COPY of a backup (one byte in the middle), never the backup itself.
      lab.post('/backups/damage', async (request, reply) => {
        const body = parse(
          z.object({ file: z.string().regex(/^db-[0-9]{8}T[0-9]{6}Z\.dump$/) }).strict(),
          request,
          reply,
        );
        if (!body) return;
        const dir = join(config.root, 'backups');
        const copy = body.file.replace(/^db-/, 'damaged-');
        await copyFile(join(dir, body.file), join(dir, copy));
        await copyFile(join(dir, `${body.file}.sha256`), join(dir, `${copy}.sha256`));
        const handle = await open(join(dir, copy), 'r+');
        try {
          const { size } = await handle.stat();
          await handle.write(Buffer.from([0xff]), 0, 1, Math.floor(size / 2));
        } finally {
          await handle.close();
        }
        return { ok: true, file: copy };
      });

      // --- drift ----------------------------------------------------------------------------------------------------
      lab.post('/drift/edit', async (request, reply) => {
        const body = parse(
          z.object({ file: z.enum(DRIFT_FILES), kind: z.enum(['edit', 'remove', 'add']) }).strict(),
          request,
          reply,
        );
        if (!body) return;
        const live = join(config.root, 'live-config');
        if (body.kind === 'edit') await appendFile(join(live, body.file), '# fixed by hand, on the server, at 3am\n');
        if (body.kind === 'remove') await rm(join(live, body.file), { force: true });
        if (body.kind === 'add') {
          await mkdir(join(live, 'nginx'), { recursive: true });
          await writeFile(join(live, 'nginx', 'leftover.conf'), '# nobody remembers who added this\n');
        }
        return { ok: true };
      });
      lab.post('/drift/sync', async () => shape(await run('drift.sh', ['sync'])));

      // --- reversible stages ----------------------------------------------------------------------------------------
      lab.post('/stages/apply', async (request, reply) => {
        const body = parse(z.object({ n: z.enum(['01', '02', '03']) }).strict(), request, reply);
        if (!body) return;
        return shape(await run('stage.sh', ['apply', body.n]));
      });
      lab.post('/stages/revert', async (request, reply) => {
        const body = parse(z.object({ n: z.enum(['01', '02', '03', 'all']) }).strict(), request, reply);
        if (!body) return;
        return shape(await run('stage.sh', ['revert', body.n === 'all' ? '--all' : body.n]));
      });
      // In the sandbox the "service" a stage must leave healthy is a file; this is the switch that makes it unwell.
      lab.post('/stages/health', async (request, reply) => {
        const body = parse(z.object({ value: z.enum(['ok', 'bad']) }).strict(), request, reply);
        if (!body) return;
        await writeFile(join(config.root, 'sandbox-root', 'var', 'lib', 'service-health'), `${body.value}\n`);
        return { ok: true, value: body.value };
      });
    },
    { prefix: '/api/lab' },
  );
}
