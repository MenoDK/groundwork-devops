/* The lab: five tabs, each one a way for delivery to go wrong. Loaded before kit.js; it only declares things.
   Everything that came from the API is inserted as text, never as markup. The page can only talk to this server
   (strict CSP). Every button that changes something goes through /api/lab/*, which answers 404 unless the lab is on. */
(() => {
  'use strict';

  const VARIANTS = [
    ['v1', 'v1 · 1.0.0'],
    ['v2', 'v2 · 1.1.0'],
    ['v3-no-database', 'v3 · cannot reach its database'],
    ['v4-orders-status', 'v4 · needs a migration'],
    ['v5-bad-edge-config', 'v5 · invalid nginx snippet'],
  ];
  const RULES = [
    ['AppDown', 'The sample service is not answering through the edge'],
    ['DeploysKeepBeingRefused', 'Three or more deploys were refused in ten minutes'],
    ['BackupStale', 'The newest backup is older than 26 hours'],
    ['RestoreDrillFailing', 'The last restore drill failed'],
    ['ConfigurationDrift', 'The server’s configuration differs from the repository'],
  ];

  const httpKind = (status) => (status >= 200 && status < 300 ? 'ok' : status >= 500 ? 'bad' : 'warn');
  const resultKind = (result) => ({ shipped: 'ok', refused: 'warn', rolled_back: 'warn' })[result] || '';
  const driftKind = (state) => ({ modified: 'warn', missing: 'bad', extra: 'warn' })[state] || '';
  const alertKind = (state) => ({ firing: 'bad', pending: 'warn' })[state] || 'ok';
  const errorText = (r) => (r.data && r.data.error ? `${r.data.error}${r.data.issues ? `: ${r.data.issues.join('; ')}` : ''}` : `The server answered ${r.status}.`);
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—');
  const kib = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  /** replaceChildren that accepts arrays and skips null, which it would otherwise print as the word "null". */
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));

  /** A card for a plain answer from the server: the status, how long it took, and the body as text. */
  function answer(k, title, r) {
    const { h, badge, out } = k;
    return h('div', { class: 'box arrive' }, h('h3', {}, title, ' ', badge(String(r.status), httpKind(r.status)), ' ', h('small', {}, `${r.ms} ms`)), out(r.data));
  }
  /** A card for a script's decision: which gate spoke, the exit code, and what the script printed on the way. */
  function decision(k, title, r) {
    const { h, badge, kv, out } = k;
    const d = r.data;
    if (!r.ok || !d || typeof d !== 'object' || !('steps' in d)) return answer(k, title, r);
    return h('div', { class: 'box arrive' },
      h('h3', {}, title, ' ', d.ok ? badge('done', 'ok') : badge(`refused · exit ${d.exitCode}`, 'warn'), ' ', h('small', {}, `${r.ms} ms`)),
      kv({ Gate: d.gate || '—', Result: d.result || '—', Message: d.message || '—' }),
      d.steps.length ? out(d.steps.join('\n')) : null);
  }
  function push(target, card, keep = 4) {
    target.prepend(card);
    while (target.children.length > keep) target.lastElementChild.remove();
  }

  let overview = null;
  const getOverview = () => {
    overview ||= fetch('/api/overview').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return overview;
  };
  /** A notice at the top of a tab when the server was started without the lab. */
  async function labNotice(k) {
    const { box } = k;
    const o = await getOverview();
    if (o && o.lab) return null;
    return box('The lab is off on this server', 'Start it with GW_LAB=1 (make up does) to use the buttons that change things. Everything that only reads still works.');
  }
  /** What the edge answers right now, asked the way a visitor would ask it. */
  async function edge() {
    try {
      const r = await fetch('/app/version', { cache: 'no-store' });
      if (!r.ok) return { up: false, text: `nothing: the edge answers ${r.status}` };
      const d = await r.json();
      return { up: true, text: `${d.version} (${d.release})` };
    } catch {
      return { up: false, text: 'nothing: no answer' };
    }
  }

  /* ---------------------------------------------------------------- ship */
  async function shipTab(panel, k) {
    const { api, h, button, badge, box, kv } = k;
    const notice = await labNotice(k);
    const live = h('div', { 'aria-live': 'polite' });
    const history = h('div', {});
    const log = h('div', {});

    async function refresh() {
      const [o, e] = await Promise.all([api('/api/overview'), edge()]);
      if (!o.ok) throw new Error('Could not read the server.');
      const l = o.data.live;
      fill(live, kv({
        'Serving now': badge(e.text, e.up ? 'ok' : 'bad'),
        'Current release': l ? `${l.release} ${l.version} on slot ${l.slot}` : 'none yet: press v1',
        'Releases on disk': String(o.data.releases.length),
      }));
      fill(history, o.data.events.length
        ? h('ul', { class: 'trace' }, o.data.events.slice(0, 8).map((ev) => h('li', {},
          h('strong', {}, ev.release), badge(ev.result.replace('_', ' '), resultKind(ev.result)), h('span', {}, `${ev.gate} · ${clock(ev.ts)} · ${ev.reason}`))))
        : h('p', { class: 'hint' }, 'No decisions yet.'));
    }
    const act = (title, path, body) => async () => {
      const r = await api(path, { method: 'POST', body: body || {} });
      push(log, decision(k, title, r));
      await refresh();
    };

    panel.append(h('div', { class: 'cols' },
      h('div', {},
        notice,
        box('1 · What is serving', 'The edge is asked the way a visitor would ask it. The history below is the file the scripts append to.', live, history,
          h('div', { class: 'row' }, button('Refresh', refresh, { small: true, ic: 'refresh' }))),
        box('2 · Ship a release', 'Each one is a different way to go wrong. The ones that should be refused leave the previous release serving.',
          h('div', { class: 'row' }, VARIANTS.map(([variant, label]) => button(label, act(`Ship ${variant}`, '/api/lab/ship', { variant }), { small: true, variant: variant === 'v1' ? 'primary' : 'secondary' }))),
          h('div', { class: 'row' },
            button('Ship v1 with a file edited', act('Ship v1, a file edited after the manifest', '/api/lab/ship', { variant: 'v1', tamper: 'edit' }), { small: true, ic: 'alert' }),
            button('Ship v1 with an extra file', act('Ship v1, a file the manifest never listed', '/api/lab/ship', { variant: 'v1', tamper: 'add' }), { small: true, ic: 'alert' })),
          h('div', { class: 'row' }, button('Roll back', act('Roll back', '/api/lab/rollback'), { small: true, ic: 'refresh' }))),
        box('3 · The ground it stands on', 'The secrets file must be private, and a release that needs a migration is refused until it has run.',
          h('div', { class: 'row' },
            button('Make the secrets file world-readable', act('Secrets file mode 644', '/api/lab/env-mode', { mode: '644' }), { small: true, ic: 'unlock' }),
            button('Make it private again', act('Secrets file mode 600', '/api/lab/env-mode', { mode: '600' }), { small: true, ic: 'lock' })),
          h('div', { class: 'row' }, button('Apply the pending migration', act('Apply the pending migration', '/api/lab/migrate', { variant: 'v4-orders-status' }), { small: true, ic: 'database' })))),
      h('div', {}, log)));
    await refresh();
  }

  /* ---------------------------------------------------------------- backups */
  async function backupsTab(panel, k) {
    const { api, h, button, badge, box } = k;
    const notice = await labNotice(k);
    const list = h('div', { 'aria-live': 'polite' });
    const log = h('div', {});

    async function load() {
      const r = await api('/api/backups');
      if (!r.ok) throw new Error('Could not read the backups.');
      const items = r.data.backups;
      fill(list, items.length
        ? h('ul', { class: 'trace' }, items.map((b) => h('li', {},
          h('strong', {}, b.file), badge(b.damaged ? 'damaged copy' : 'original', b.damaged ? 'bad' : 'ok'),
          h('span', {}, [kib(b.bytes), ...Object.entries(b.tables).map(([t, n]) => `${t}: ${n}`)].join(' · ')),
          h('span', { class: 'row' },
            button('Drill', () => act(`Drill ${b.file}`, '/api/lab/backups/drill', { file: b.file })(), { small: true, ic: 'check' }),
            b.damaged ? null : button('Damage a copy', () => act(`Damage a copy of ${b.file}`, '/api/lab/backups/damage', { file: b.file })(), { small: true, ic: 'alert' })))))
        : h('p', { class: 'hint' }, 'No backups yet. Take one.'));
    }
    const act = (title, path, body) => async () => {
      const r = await api(path, { method: 'POST', body: body || {} });
      push(log, decision(k, title, r));
      await load();
    };

    panel.append(h('div', { class: 'cols' },
      h('div', {},
        notice,
        box('1 · Take, rotate', 'A dump with its checksum and the row count of every table, taken from the running database.',
          h('div', { class: 'row' },
            button('Take a backup', act('Take a backup', '/api/lab/backups/take'), { variant: 'primary', ic: 'database' }),
            button('Keep the newest 2', act('Keep the newest 2', '/api/lab/backups/rotate', { keep: 2 }), { small: true, ic: 'refresh' }))),
        box('2 · The copies', 'Drill restores one into a scratch database and compares the rows. “Damage a copy” flips one byte in a copy of the file, never in the original.', list,
          h('div', { class: 'row' }, button('Refresh', load, { small: true, ic: 'refresh' })))),
      h('div', {}, log)));
    await load();
  }

  /* ---------------------------------------------------------------- alerts */
  async function alertsTab(panel, k) {
    const { api, h, button, badge, box, out } = k;
    const notice = await labNotice(k);
    const rules = h('div', { 'aria-live': 'polite' });
    const targets = h('div', {});
    const timeline = h('div', {});
    const log = h('div', {});
    const seen = new Map();
    let timer = null;

    async function refresh() {
      const r = await api('/api/alerts');
      if (!r.ok) return;
      if (!r.data.available) {
        fill(rules, h('p', { class: 'hint' }, 'Prometheus is not reachable from the server, so there is nothing to show. Start the whole stack with make up.'));
        return;
      }
      const byName = new Map(r.data.alerts.map((a) => [a.name, a]));
      fill(rules, h('ul', { class: 'trace' }, RULES.map(([name, summary]) => {
        const a = byName.get(name);
        const state = a ? a.state : 'quiet';
        const before = seen.get(name);
        if (before !== undefined && before !== state) {
          timeline.prepend(h('p', { class: 'hint' }, `${new Date().toLocaleTimeString([], { hour12: false })} · ${name}: ${before} → ${state}`));
          while (timeline.children.length > 8) timeline.lastElementChild.remove();
        }
        seen.set(name, state);
        return h('li', {}, h('strong', {}, name), badge(state, alertKind(state)), h('span', {}, summary));
      })));
      fill(targets, h('ul', { class: 'trace' }, r.data.targets.map((t) => h('li', {}, h('strong', {}, t.job), badge(t.health, t.health === 'up' ? 'ok' : 'bad')))));
    }
    function tick() {
      if (!panel.isConnected) { clearInterval(timer); return; }
      refresh().catch(() => {});
    }
    const act = (title, path, body) => async () => {
      const r = await api(path, { method: 'POST', body: body || {} });
      push(log, decision(k, title, r));
      await refresh();
    };
    async function metrics() {
      const res = await fetch('/metrics');
      const text = await res.text();
      push(log, h('div', { class: 'box arrive' }, h('h3', {}, 'GET /metrics ', badge(String(res.status), httpKind(res.status))), out(text.split('\n').filter((l) => l.startsWith('gw_')).join('\n'))), 2);
    }

    panel.append(h('div', { class: 'cols' },
      h('div', {},
        notice,
        box('1 · Kill the service', 'The live process dies; the edge answers 502 from then on. AppDown needs fifteen seconds of failed scrapes before it fires.',
          h('div', { class: 'row' },
            button('Stop the live process', act('Stop the live process', '/api/lab/app', { action: 'stop' }), { variant: 'primary', ic: 'alert' }),
            button('Start it again', act('Start it again', '/api/lab/app', { action: 'start' }), { ic: 'play' }))),
        box('2 · What Prometheus says', 'The five rules from prometheus/rules.yml, asked every three seconds while this tab is open.', rules,
          h('p', { class: 'hint' }, 'Scrape targets:'), targets,
          h('div', { class: 'row' }, button('What the control API exports', metrics, { small: true, ic: 'chart' })))),
      h('div', {}, box('Changes of state', 'Written here as they are seen.', timeline), log)));
    timer = setInterval(tick, 3000);
    await refresh();
  }

  /* ---------------------------------------------------------------- drift */
  async function driftTab(panel, k) {
    const { api, h, button, badge, box } = k;
    const notice = await labNotice(k);
    const verdict = h('div', { 'aria-live': 'polite' });
    const log = h('div', {});
    const TIMER = 'systemd/groundwork-backup.timer';
    const HEADERS = 'nginx/security-headers.conf';

    async function check() {
      const r = await api('/api/drift');
      if (!r.ok) throw new Error('Could not compare.');
      fill(verdict, h('div', { class: 'box arrive' },
        h('h3', {}, 'The server against the repository ', badge(r.data.drifted ? 'drifted' : 'clean', r.data.drifted ? 'warn' : 'ok')),
        r.data.files.length
          ? h('ul', { class: 'trace' }, r.data.files.map((f) => h('li', {}, h('strong', {}, f.path), badge(f.state, driftKind(f.state)))))
          : h('p', { class: 'hint' }, 'Every file the repository owns is on the server, byte for byte, and nothing else is there.')));
    }
    const edit = (title, file, kind) => async () => {
      const r = await api('/api/lab/drift/edit', { method: 'POST', body: { file, kind } });
      push(log, answer(k, title, r), 5);
    };
    async function sync() {
      const r = await api('/api/lab/drift/sync', { method: 'POST', body: {} });
      push(log, decision(k, 'Sync', r), 5);
      await check();
    }

    panel.append(h('div', { class: 'cols' },
      h('div', {},
        notice,
        box('1 · Edit the server by hand', 'Each button changes the live configuration the way a tired person would, without telling the repository.',
          h('div', { class: 'row' },
            button('Edit the backup timer', edit('Append a line to the backup timer', TIMER, 'edit'), { small: true }),
            button('Delete the security headers', edit('Delete the security headers file', HEADERS, 'remove'), { small: true }),
            button('Add a leftover file', edit('Add a file nobody asked for', HEADERS, 'add'), { small: true }))),
        box('2 · Compare', 'Check lists what differs. Sync puts the repository’s version back and keeps a copy of everything it replaced.',
          h('div', { class: 'row' },
            button('Check', check, { variant: 'primary', ic: 'search' }),
            button('Sync', sync, { ic: 'refresh' })),
          verdict)),
      h('div', {}, log)));
    await check();
  }

  /* ---------------------------------------------------------------- undo */
  async function undoTab(panel, k) {
    const { api, h, button, badge, box } = k;
    const notice = await labNotice(k);
    const list = h('div', { 'aria-live': 'polite' });
    const health = h('span', {});
    const log = h('div', {});

    async function load() {
      const r = await api('/api/stages');
      if (!r.ok) throw new Error('Could not read the stages.');
      fill(list, h('ul', { class: 'trace' }, r.data.stages.map((s) => h('li', {},
        h('code', {}, s.n), badge(s.state, s.state === 'applied' ? 'ok' : ''), h('span', {}, s.title),
        h('span', { class: 'row' },
          s.state === 'available' ? button('Apply', () => act(`Apply stage ${s.n}`, '/api/lab/stages/apply', { n: s.n })(), { small: true, ic: 'play' }) : null,
          s.state === 'applied' ? button('Revert', () => act(`Revert stage ${s.n}`, '/api/lab/stages/revert', { n: s.n })(), { small: true, ic: 'refresh' }) : null)))));
    }
    const act = (title, path, body) => async () => {
      const r = await api(path, { method: 'POST', body: body || {} });
      push(log, decision(k, title, r));
      await load();
    };
    const setHealth = (value) => async () => {
      const r = await api('/api/lab/stages/health', { method: 'POST', body: { value } });
      if (!r.ok) throw new Error(errorText(r));
      fill(health, badge(value === 'bad' ? 'last set: unwell' : 'last set: well', value === 'bad' ? 'bad' : 'ok'));
    };

    panel.append(h('div', { class: 'cols' },
      h('div', {},
        notice,
        box('1 · The stages', 'Each one backs up what it touches, makes its change inside a sandbox that stands in for /etc, and runs its own check.', list),
        box('2 · The service the stages must leave healthy', 'Stage 03 turns core dumps off and then asks the service whether it is still well. Make it unwell first and see what happens.',
          h('div', { class: 'row' },
            button('Make the service unwell', setHealth('bad'), { small: true, ic: 'alert' }),
            button('Make the service well', setHealth('ok'), { small: true, ic: 'heart' }),
            health)),
        box('3 · Take everything back', 'Newest stage first, and each file is compared with what it was before.',
          h('div', { class: 'row' }, button('Revert everything', act('Revert everything', '/api/lab/stages/revert', { n: 'all' }), { variant: 'primary', ic: 'refresh' })))),
      h('div', {}, log)));
    await load();
  }

  window.LAB = {
    eyebrow: 'The lab',
    title: 'Try to ship something broken.',
    text: 'Five ways for delivery to go wrong, each backed by tests. Everything runs on this machine against fictional data.',
    reset: {
      label: 'Start over',
      hint: 'Secrets file private, service running, configuration synced, stages reverted. The history of decisions is kept.',
      done: 'Back to a clean slate (the history keeps its decisions).',
      run: async ({ api }) => {
        const steps = [
          ['/api/lab/env-mode', { mode: '600' }],
          ['/api/lab/app', { action: 'start' }],
          ['/api/lab/drift/sync', {}],
          ['/api/lab/stages/health', { value: 'ok' }],
          ['/api/lab/stages/revert', { n: 'all' }],
        ];
        for (const [path, body] of steps) {
          const r = await api(path, { method: 'POST', body });
          // starting a service that is already running is not an error worth stopping for; the others are
          if (!r.ok && !path.endsWith('/app')) throw new Error('Could not reset the lab.');
        }
      },
    },
    tabs: [
      { id: 'ship', label: 'Ship', icon: 'box', render: (p, k) => shipTab(p, k) },
      { id: 'backups', label: 'Backups', icon: 'database', render: (p, k) => backupsTab(p, k) },
      { id: 'alerts', label: 'Alerts', icon: 'eye', render: (p, k) => alertsTab(p, k) },
      { id: 'drift', label: 'Drift', icon: 'git', render: (p, k) => driftTab(p, k) },
      { id: 'undo', label: 'Undo', icon: 'refresh', render: (p, k) => undoTab(p, k) },
    ],
  };
})();
