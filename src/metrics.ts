import type { Config } from './config.js';
import type { Runner } from './runner.js';
import { readBackups, readEvents, readLive, readReleases } from './state.js';

/** The gates deploy.sh can speak with. Other scripts log to the same file under their own names (backup, drill, drift, stage, process). */
const DEPLOY_GATES = new Set([
  'all',
  'rollback',
  'artifact_unverified',
  'env_permissions',
  'migrations_pending',
  'unhealthy',
  'nginx_invalid',
  'edge_verification_failed',
  'deploy_in_progress',
  'nothing_to_roll_back',
]);

let driftCache: { at: number; files: number } | null = null;

/** How many files differ from the repository. Cached for a few seconds: Prometheus asks every five. */
async function driftFiles(run: Runner): Promise<number> {
  const now = Date.now();
  if (driftCache && now - driftCache.at < 3000) return driftCache.files;
  const out = await run('drift.sh', ['check']);
  const files = Array.isArray(out.result?.detail) ? out.result.detail.length : 0;
  driftCache = { at: now, files };
  return files;
}

/** Prometheus text format. Everything here is read from files the scripts wrote; nothing is kept in memory. */
export async function renderMetrics(config: Config, run: Runner): Promise<string> {
  const events = await readEvents(config, 5000);
  const lines: string[] = [];

  lines.push('# TYPE gw_deploys_total counter');
  for (const result of ['shipped', 'refused', 'rolled_back'] as const) {
    const n = events.filter((e) => e.result === result && DEPLOY_GATES.has(e.gate)).length;
    lines.push(`gw_deploys_total{result="${result}"} ${n}`);
  }

  const live = await readLive(config);
  lines.push('# TYPE gw_live_release_info gauge');
  if (live) lines.push(`gw_live_release_info{release="${live.release}",version="${live.version}"} 1`);
  lines.push('# TYPE gw_releases_on_disk gauge');
  lines.push(`gw_releases_on_disk ${(await readReleases(config)).length}`);

  const backups = (await readBackups(config)).filter((b) => !b.damaged && b.taken_at);
  if (backups[0]) {
    lines.push('# TYPE gw_last_backup_timestamp_seconds gauge');
    lines.push(`gw_last_backup_timestamp_seconds ${Math.floor(Date.parse(backups[0].taken_at) / 1000)}`);
  }
  const drills = events.filter((e) => e.gate === 'drill');
  const lastDrill = drills[drills.length - 1];
  if (lastDrill) {
    lines.push('# TYPE gw_last_drill_ok gauge');
    lines.push(`gw_last_drill_ok ${lastDrill.result === 'shipped' ? 1 : 0}`);
  }

  lines.push('# TYPE gw_config_drift_files gauge');
  lines.push(`gw_config_drift_files ${await driftFiles(run)}`);
  return `${lines.join('\n')}\n`;
}

/** For tests: forget the cached drift count. */
export function resetMetricsCache(): void {
  driftCache = null;
}
