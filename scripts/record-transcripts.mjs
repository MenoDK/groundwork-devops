#!/usr/bin/env node
/**
 * Records the output shown in the landing page's tour by driving the RUNNING stack (`make up`) through its front door.
 * Nothing on that page is typed by hand.
 *
 *   node scripts/record-transcripts.mjs            write site/transcripts.js
 *   node scripts/record-transcripts.mjs --check    record again and fail if site/transcripts.js no longer matches
 *
 * Timestamps, slot ports and byte counts change on every run, so they are replaced by placeholders: what is compared is
 * what the system *said*, not the values it said it with. The stack must run with the lab on (make up does), and the
 * recording takes a couple of minutes because the alert section waits for Prometheus to notice.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'transcripts.js');
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.GW_PORT ?? 8100}`;
const check = process.argv.includes('--check');

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lines of a transcript. The kit inserts a transcript as HTML, so every character is escaped when it is rendered. */
class Tape {
  #entries = [];
  say(text) {
    if (this.#entries.length > 0) this.#entries.push({ text: '' });
    this.#entries.push({ cls: 'tok-dim', text: `# ${text}` });
  }
  call(request, reply, shown, body) {
    this.#entries.push({ cls: 'tok-k', text: `→ ${request}` });
    if (body !== undefined) this.#entries.push({ cls: 'tok-dim', text: `  ${JSON.stringify(body)}` });
    this.#entries.push({ cls: reply.status < 400 ? 'tok-ok' : 'tok-bad', text: `← ${reply.status}` });
    const out = shown ? shown(reply.data) : reply.data;
    this.#entries.push({ text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) });
  }
  render() {
    const normalise = (text) =>
      text
        .replace(/:41(01|02)\b/g, ':<slot>')
        .replace(/\d{8}T\d{6}Z?/g, '<timestamp>')
        .replace(/\(\d+ bytes\)/g, '(<n> bytes)')
        .replace(/"bytes": \d+/g, '"bytes": "<n>"');
    return this.#entries
      .map(({ cls, text }) => {
        const shown = escapeHtml(normalise(text));
        return cls ? `<span class="${cls}">${shown}</span>` : shown;
      })
      .join('\n');
  }
}

/* ------------------------------------------------------------------ talking to the stack */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep the text */
  }
  return { status: res.status, data };
}
const post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
const ok = (r, what) => {
  if (r.status >= 400) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const pick = (obj, ...keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
/** What a script printed on the way, then the decision it ended with. */
const decision = (d) => `${d.steps.join('\n')}\n— exit ${d.exitCode} · gate ${d.gate} · ${d.result}`;
const appDown = (alerts) =>
  alerts.filter((a) => a.name === 'AppDown').map((a) => pick(a, 'name', 'severity', 'state', 'summary'));

async function waitFor(what, predicate, seconds) {
  for (let i = 0; i < seconds / 3; i += 1) {
    if (await predicate()) return;
    await sleep(3000);
  }
  throw new Error(`${what} did not happen within ${seconds} seconds`);
}
const alerts = async () => ok(await api('/api/alerts'), 'alerts');

/** The same starting point whatever an earlier run left behind. */
async function settle() {
  ok(await post('/api/lab/env-mode', { mode: '600' }), 'env-mode');
  await post('/api/lab/app', { action: 'start' }); // refused when nothing is live yet, which is fine
  ok(await post('/api/lab/drift/sync'), 'sync');
  ok(await post('/api/lab/stages/health', { value: 'ok' }), 'health');
  ok(await post('/api/lab/stages/revert', { n: 'all' }), 'revert');
  ok(await post('/api/lab/ship', { variant: 'v2' }), 'ship v2');
  ok(await post('/api/lab/ship', { variant: 'v1' }), 'ship v1');
}

const overview = ok(await api('/api/overview'), 'overview');
if (!overview.lab) throw new Error('the stack must run with GW_LAB=1 (make up does)');

/* ------------------------------------------------------------------ the transcripts */
async function ship() {
  const t = new Tape();
  await settle();
  t.say('A release goes through every gate, in order. Each line is a check that passed.');
  t.call('POST /api/lab/ship', await post('/api/lab/ship', { variant: 'v2' }), decision, { variant: 'v2' });
  t.call('GET /app/version  (through the edge)', await api('/app/version'));
  t.say('The next release cannot reach its database. The candidate starts, fails its health check, and is stopped.');
  t.call('POST /api/lab/ship', await post('/api/lab/ship', { variant: 'v3-no-database' }), decision, {
    variant: 'v3-no-database',
  });
  t.call('GET /app/version', await api('/app/version'));
  t.say('A release whose nginx snippet is invalid never reaches the running server.');
  t.call(
    'POST /api/lab/ship',
    await post('/api/lab/ship', { variant: 'v5-bad-edge-config' }),
    (d) => pick(d, 'ok', 'exitCode', 'gate', 'result', 'message'),
    { variant: 'v5-bad-edge-config' },
  );
  t.say('A package changed after its manifest was written is refused before anything is copied into place.');
  t.call(
    'POST /api/lab/ship',
    await post('/api/lab/ship', { variant: 'v1', tamper: 'edit' }),
    (d) => pick(d, 'ok', 'exitCode', 'gate', 'result', 'message'),
    { variant: 'v1', tamper: 'edit' },
  );
  t.say('A secrets file that other users can read stops the deploy.');
  ok(await post('/api/lab/env-mode', { mode: '644' }), 'env-mode');
  t.call(
    'POST /api/lab/ship',
    await post('/api/lab/ship', { variant: 'v2' }),
    (d) => pick(d, 'ok', 'exitCode', 'gate', 'result', 'message'),
    { variant: 'v2' },
  );
  ok(await post('/api/lab/env-mode', { mode: '600' }), 'env-mode');
  t.say('Every decision, including the refusals, is one line of history. The release that is serving never changed.');
  const events = ok(await api('/api/deploys'), 'deploys')
    .events.slice(0, 5)
    .reverse();
  t.call('GET /api/deploys', { status: 200, data: events }, (d) =>
    d.map((e) => `${e.gate.padEnd(20)} ${e.result.padEnd(8)} ${e.release}`).join('\n'),
  );
  return t.render();
}

async function backups() {
  const t = new Tape();
  await settle();
  t.say('A dump, its checksum, and the row count of every table at that moment.');
  t.call('POST /api/lab/backups/take', await post('/api/lab/backups/take'), decision);
  const listed = ok(await api('/api/backups'), 'backups').backups.filter((b) => !b.damaged);
  const newest = listed[0];
  t.call('GET /api/backups', { status: 200, data: [newest] }, (d) =>
    d.map((b) => pick(b, 'file', 'bytes', 'tables', 'damaged')),
  );
  t.say('The drill restores it into a scratch database, counts the rows, compares, and drops the scratch database.');
  t.call('POST /api/lab/backups/drill', await post('/api/lab/backups/drill', { file: newest.file }), decision, {
    file: newest.file,
  });
  t.say('One byte of a copy is flipped. The checksum notices before anything is restored.');
  const damaged = ok(await post('/api/lab/backups/damage', { file: newest.file }), 'damage');
  t.call('POST /api/lab/backups/drill', await post('/api/lab/backups/drill', { file: damaged.file }), decision, {
    file: damaged.file,
  });
  ok(await post('/api/lab/backups/drill', { file: newest.file }), 'drill the original again'); // leave the last drill green
  return t.render();
}

async function alertsTranscript() {
  const t = new Tape();
  await settle();
  await waitFor('AppDown to be quiet', async () => appDown((await alerts()).alerts).length === 0, 120);
  t.say('Prometheus scrapes the sample service through the edge, and the control API as well. Nothing is wrong.');
  t.call('GET /api/alerts', await api('/api/alerts'), (d) => ({ targets: d.targets, appDown: appDown(d.alerts) }));
  t.say('The live process is stopped. The edge answers 502 from now on.');
  t.call(
    'POST /api/lab/app',
    await post('/api/lab/app', { action: 'stop' }),
    (d) => pick(d, 'ok', 'gate', 'result', 'message'),
    { action: 'stop' },
  );
  await waitFor('AppDown to fire', async () => appDown((await alerts()).alerts).some((a) => a.state === 'firing'), 120);
  t.say('After fifteen seconds of failed scrapes the rule fires.');
  t.call('GET /api/alerts', await api('/api/alerts'), (d) => ({ appDown: appDown(d.alerts) }));
  t.say('The process comes back. The alert clears on its own.');
  t.call(
    'POST /api/lab/app',
    await post('/api/lab/app', { action: 'start' }),
    (d) => pick(d, 'ok', 'gate', 'result', 'message'),
    { action: 'start' },
  );
  await waitFor('AppDown to clear', async () => appDown((await alerts()).alerts).length === 0, 120);
  t.call('GET /api/alerts', await api('/api/alerts'), (d) => ({ appDown: appDown(d.alerts) }));
  return t.render();
}

async function drift() {
  const t = new Tape();
  await settle();
  t.say('A fresh server matches the repository.');
  t.call('GET /api/drift', await api('/api/drift'));
  t.say('Someone fixes things by hand at 3 a.m.: edits one file, deletes another, and leaves a stray one.');
  const edits = [
    { file: 'systemd/groundwork-backup.timer', kind: 'edit' },
    { file: 'nginx/security-headers.conf', kind: 'remove' },
    { file: 'nginx/security-headers.conf', kind: 'add' },
  ];
  for (const body of edits) ok(await post('/api/lab/drift/edit', body), 'drift edit');
  t.call('GET /api/drift', await api('/api/drift'));
  t.say('Sync puts the repository’s version back, and keeps a copy of everything it replaced.');
  t.call('POST /api/lab/drift/sync', await post('/api/lab/drift/sync'), decision);
  t.call('GET /api/drift', await api('/api/drift'));
  return t.render();
}

async function undo() {
  const t = new Tape();
  await settle();
  t.say('Three numbered changes to a machine, none applied. They run inside a sandbox that stands in for /etc.');
  t.call('GET /api/stages', await api('/api/stages'));
  t.say('Stage 01 changes a file, runs its own check, and passes.');
  t.call('POST /api/lab/stages/apply', await post('/api/lab/stages/apply', { n: '01' }), decision, { n: '01' });
  t.say(
    'The service is unwell. Stage 03 changes a setting, runs its check, and the check fails: it takes itself back.',
  );
  ok(await post('/api/lab/stages/health', { value: 'bad' }), 'health');
  t.call('POST /api/lab/stages/apply', await post('/api/lab/stages/apply', { n: '03' }), decision, { n: '03' });
  t.call('GET /api/stages', await api('/api/stages'));
  t.say(
    'Everything that is applied can be taken back, newest first, and the result is compared with what it was before.',
  );
  ok(await post('/api/lab/stages/health', { value: 'ok' }), 'health');
  t.call('POST /api/lab/stages/revert', await post('/api/lab/stages/revert', { n: 'all' }), decision, { n: 'all' });
  return t.render();
}

/* ------------------------------------------------------------------ main */
const transcripts = {
  ship: await ship(),
  backups: await backups(),
  alerts: await alertsTranscript(),
  drift: await drift(),
  undo: await undo(),
};
await settle();
const file = `/* Recorded from the running stack by scripts/record-transcripts.mjs. Do not edit: CI records again and compares. */\nwindow.TRANSCRIPTS = ${JSON.stringify(transcripts, null, 2)};\n`;
if (check) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== file) {
    const names = Object.keys(transcripts).filter((k) => !current.includes(JSON.stringify(transcripts[k])));
    console.error(
      `site/transcripts.js is out of date for: ${names.join(', ') || '(formatting)'}. Run: node scripts/record-transcripts.mjs`,
    );
    process.exit(1);
  }
  console.log('transcripts match what the stack says');
} else {
  writeFileSync(OUT, file);
  console.log(`wrote ${OUT}`);
}
