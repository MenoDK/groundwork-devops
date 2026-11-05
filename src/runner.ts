import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { Config } from './config.js';

/** Every script the API may run. A request never chooses a program: it chooses one of these names. */
export const SCRIPTS = [
  'deploy.sh',
  'migrate.sh',
  'backup.sh',
  'drift.sh',
  'stage.sh',
  'build-release.sh',
  'app-ctl.sh',
] as const;
export type Script = (typeof SCRIPTS)[number];

/** What every script prints on its last line (see ops/lib.sh). */
export interface ScriptResult {
  ok: boolean;
  gate: string;
  result: string;
  message: string;
  release: string;
  detail: unknown;
}

export interface Outcome {
  exitCode: number;
  steps: string[];
  result: ScriptResult | null;
}

export type Runner = (script: Script, args: readonly string[]) => Promise<Outcome>;

const MAX_OUTPUT = 256 * 1024;

/** Pulls the last RESULT line out of a script's output, and the human lines before it. */
export function parseOutput(exitCode: number, stdout: string): Outcome {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  let result: ScriptResult | null = null;
  const steps: string[] = [];
  for (const line of lines) {
    if (line.startsWith('RESULT ')) {
      try {
        result = JSON.parse(line.slice('RESULT '.length)) as ScriptResult;
      } catch {
        steps.push(line);
      }
    } else {
      steps.push(line);
    }
  }
  return { exitCode, steps, result };
}

/** Runs a script with execFile: no shell, so an argument is only ever an argument. */
export function shellRunner(config: Config, timeoutMs = 60_000): Runner {
  return (script, args) =>
    new Promise((resolve) => {
      execFile(
        join(config.opt, 'ops', script),
        [...args],
        {
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
          env: { ...process.env, GW_ROOT: config.root, GW_OPT: config.opt },
        },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          const out = parseOutput(code, stdout);
          if (code !== 0 && out.result === null && stderr)
            out.steps.push(stderr.trim().split('\n').slice(-3).join(' '));
          resolve(out);
        },
      );
    });
}
