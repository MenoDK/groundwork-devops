import { readFile, readdir, readlink, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Config } from './config.js';

export interface DeployEvent {
  ts: string;
  release: string;
  gate: string;
  result: 'shipped' | 'refused' | 'rolled_back';
  reason: string;
}

export interface Live {
  release: string;
  version: string;
  slot: number;
  directory: string;
}

export interface Backup {
  file: string;
  taken_at: string;
  bytes: number;
  tables: Record<string, number>;
  damaged: boolean;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** The newest events, oldest first. A line that is not JSON is skipped: a torn write must not take the page down. */
export async function readEvents(config: Config, limit = 200): Promise<DeployEvent[]> {
  const text = await readText(join(config.root, 'deploy-log.jsonl'));
  if (text === null) return [];
  const events: DeployEvent[] = [];
  for (const line of text.split('\n').slice(-5000)) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as DeployEvent);
    } catch {
      // skip
    }
  }
  return events.slice(-limit);
}

/** The release that is serving: where `current` points, and what its release.json says. */
export async function readLive(config: Config): Promise<Live | null> {
  let directory: string;
  try {
    directory = await readlink(join(config.root, 'current'));
  } catch {
    return null;
  }
  const meta = await readText(join(directory, 'release.json'));
  const slot = await readText(join(config.root, 'run', 'live-slot'));
  if (meta === null || slot === null) return null;
  try {
    const parsed = JSON.parse(meta) as { name: string; version: string };
    return { release: parsed.name, version: parsed.version, slot: Number(slot.trim()), directory: basename(directory) };
  } catch {
    return null;
  }
}

/** The release directories on disk, newest first. */
export async function readReleases(config: Config): Promise<string[]> {
  try {
    return (await readdir(join(config.root, 'releases'))).sort().reverse();
  } catch {
    return [];
  }
}

export async function readBackups(config: Config): Promise<Backup[]> {
  const dir = join(config.root, 'backups');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const backups: Backup[] = [];
  for (const name of names.filter((n) => n.endsWith('.dump'))) {
    const damaged = name.startsWith('damaged-');
    const metaText = await readText(join(dir, `${name}.meta.json`));
    let tables: Record<string, number> = {};
    let takenAt = '';
    if (metaText) {
      try {
        const m = JSON.parse(metaText) as { taken_at: string; tables: Record<string, number> };
        tables = m.tables;
        takenAt = m.taken_at;
      } catch {
        // a damaged copy may carry a meta we cannot read; it is listed all the same
      }
    }
    const info = await stat(join(dir, name));
    backups.push({ file: name, taken_at: takenAt, bytes: info.size, tables, damaged });
  }
  return backups.sort((a, b) => (a.file < b.file ? 1 : -1));
}

export const BACKUP_FILE = /^(db|damaged)-[0-9]{8}T[0-9]{6}Z(-[0-9]+)?\.dump$/;
