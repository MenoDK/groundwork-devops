import { z } from 'zod';

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  GW_ROOT: z.string().min(1).default('/srv/groundwork'),
  GW_OPT: z.string().min(1).default('/opt/groundwork'),
  GW_CONTROL_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  GW_EDGE_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  GW_ENV: z.enum(['development', 'production']).default('development'),
  GW_LAB: flag,
  GW_SITE_DIR: z.string().optional(),
  GW_PROMETHEUS_URL: z.string().url().optional(),
  GW_ALLOWED_HOSTS: z.string().optional(),
});

export interface Config {
  root: string;
  opt: string;
  controlPort: number;
  edgePort: number;
  production: boolean;
  lab: boolean;
  siteDir: string;
  prometheusUrl: string | null;
  allowedHosts: ReadonlySet<string>;
}

/** The names the server answers to. Everything else is refused, which is what defeats DNS rebinding. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const c = parsed.data;
  const production = c.GW_ENV === 'production';
  // The lab breaks things on purpose (damages a backup, edits the live configuration, stops the service) and has no login.
  if (production && c.GW_LAB) {
    throw new ConfigError('GW_LAB=1 is refused when GW_ENV=production: the lab has no authentication on purpose');
  }
  const extra = (c.GW_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    root: c.GW_ROOT,
    opt: c.GW_OPT,
    controlPort: c.GW_CONTROL_PORT,
    edgePort: c.GW_EDGE_PORT,
    production,
    lab: c.GW_LAB,
    siteDir: c.GW_SITE_DIR ?? `${c.GW_OPT}/site`,
    prometheusUrl: c.GW_PROMETHEUS_URL ?? null,
    allowedHosts: new Set([...LOOPBACK, ...extra]),
  };
}
