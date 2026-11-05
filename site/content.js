/* Content for the landing page and the lab. Everything the page says about behaviour is backed by a test; the output in
   the tour is recorded from the running stack (scripts/record-transcripts.mjs) and CI fails if it drifts. */
window.SITE = {
  name: 'groundwork-devops',
  short: 'Groundwork',
  title: 'groundwork-devops · shipping software without crossing your fingers',
  logo: 'server',
  repo: 'https://github.com/MenoDK/groundwork-devops',
  accent: {
    light: { fill: '#e45a9c', ink: '#a3235f', on: '#2a0a1b', soft: '#fce1ef', onNavy: '#ff8cc0' },
    dark: { fill: '#ec6aa8', ink: '#ffa6cc', on: '#2a0a1b', soft: '#4a1531', onNavy: '#ff8cc0' },
  },
  loading: {
    context: 'DevOps',
    title: 'Pouring the foundation',
    text: 'Checking the edge, the release, the database and the alert rules.',
    icon: 'server',
    satellites: ['database', 'check', 'clock'],
    foot: 'Local demo · one container plays a server, nothing leaves this machine',
    sketch: 'M10 122C56 122 66 58 112 58S158 128 204 128 252 70 300 70 322 112 334 112',
  },
  lab: { href: 'lab.html', cta: 'Enter the lab' },

  hero: {
    eyebrow: 'Delivery · a verified release, a proven backup, an honest alert',
    lead: 'Shipping software',
    soft: 'without crossing your fingers.',
    text: 'A small server and the delivery machinery around it. A release goes live only after its files were checked, its health was proven and the web server accepted the configuration, and when any step refuses, the old release keeps serving. A backup counts once it was restored into a scratch database and compared. An alert fires when the service dies and clears when it returns. A change to the machine takes itself back when its own check fails.',
    primary: { label: 'Open the lab', href: 'lab.html' },
    secondary: { label: 'See how it works', href: '#tour', icon: 'layers' },
    pilot: 'Runs on your laptop · Docker only, no cloud account, no credentials',
    proof: [
      { icon: 'check', a: 'Every gate can refuse', b: 'and the old release keeps serving' },
      { icon: 'flask', a: 'Every failure is a button', b: 'in a lab you can click' },
    ],
    top: ['GROUNDWORK', 'Verified before shipped. Restored before trusted.'],
    status: { icon: 'server', small: 'Last decision', strong: 'Release 1.2.0 could not reach its database. Refused. 1.1.0 kept serving.' },
    art: `<svg viewBox="0 50 500 620" role="img" aria-label="A release package lists its files with checksums, and one extra file is not on the list. It goes through four gates towards the web server, which keeps serving release 1.1.0 while 1.2.0 is refused. Below, a database dump is restored into a scratch database that shows a thousand rows, an alert called AppDown goes from pending to firing to cleared, and a row of four numbered changes shows the third one failing its own check and being reverted.">
      <g class="a-line"><path d="M0 120H500M0 240H500M0 360H500M0 480H500M0 600H500M100 30V700M250 30V700M400 30V700"/></g>
      <g transform="translate(0 42)">
      <circle cx="420" cy="132" r="62" class="a-soft"/>

      <g>
        <rect x="26" y="96" width="162" height="112" rx="14" class="a-body"/>
        <rect x="26" y="96" width="162" height="112" rx="14" class="a-line"/>
        <text x="42" y="120" class="a-text-s">RELEASE 1.2.0</text>
        <path d="M42 130h130" class="a-line"/>
        <text x="42" y="147" class="a-text-s">server.mjs  9f3a…</text>
        <text x="42" y="163" class="a-text-s">release.json  c71e…</text>
        <rect x="34" y="171" width="146" height="26" rx="8" class="a-bad-f" fill-opacity="0.3"/>
        <text x="42" y="188" class="a-text-s">extra.mjs  not listed</text>
      </g>

      <path d="M192 152H236" class="a-dash"/>
      <path d="M228 144l10 8-10 8" class="a-accent-s"/>
      <g>
        <rect x="240" y="104" width="74" height="96" rx="16" class="a-body"/>
        <rect x="240" y="104" width="74" height="96" rx="16" class="a-line"/>
        <path d="M254 124l5 5 9-10M254 144l5 5 9-10M254 164l5 5 9-10M254 184l5 5 9-10" class="a-accent-s"/>
        <path d="M276 124h26M276 144h26M276 164h26M276 184h26" class="a-line"/>
        <text x="277" y="218" text-anchor="middle" class="a-text">GATES</text>
      </g>
      <path d="M316 152H344" class="a-dash"/>

      <g>
        <rect x="346" y="92" width="122" height="82" rx="14" class="a-body"/>
        <rect x="346" y="92" width="122" height="82" rx="14" class="a-line"/>
        <text x="407" y="110" text-anchor="middle" class="a-text-s">EDGE</text>
        <rect x="354" y="118" width="106" height="20" rx="7" class="a-line"/>
        <circle cx="365" cy="128" r="3.4" class="a-accent pulse"/>
        <text x="376" y="132" class="a-text-s">1.1.0 live</text>
        <rect x="354" y="144" width="106" height="20" rx="7" class="a-bad-f" fill-opacity="0.3"/>
        <text x="362" y="158" class="a-text-s">1.2.0 refused</text>
        <text x="407" y="190" text-anchor="middle" class="a-text-s">the old one keeps serving</text>
      </g>
      </g>

      <g>
        <rect x="26" y="300" width="96" height="62" rx="12" class="a-body"/>
        <rect x="26" y="300" width="96" height="62" rx="12" class="a-line"/>
        <text x="74" y="322" text-anchor="middle" class="a-text-s">BACKUP</text>
        <text x="74" y="340" text-anchor="middle" class="a-text-s">db-….dump</text>
        <text x="74" y="354" text-anchor="middle" class="a-text-s">sha256 ✓</text>
      </g>
      <path d="M124 331H158" class="a-dash"/>
      <path d="M150 323l10 8-10 8" class="a-accent-s"/>
      <g>
        <path d="M168 312c0-9 28-9 28 0v38c0 9-28 9-28 0z" class="a-body"/>
        <path d="M168 312c0-9 28-9 28 0v38c0 9-28 9-28 0z" class="a-line"/>
        <path d="M168 312c0 9 28 9 28 0" class="a-line"/>
        <text x="182" y="378" text-anchor="middle" class="a-text-s">scratch DB</text>
        <text x="182" y="392" text-anchor="middle" class="a-text-s">1000 rows ✓</text>
      </g>

      <g>
        <rect x="236" y="290" width="214" height="100" rx="16" class="a-body"/>
        <rect x="236" y="290" width="214" height="100" rx="16" class="a-line"/>
        <path d="M236 320h214" class="a-line"/>
        <text x="252" y="310" class="a-text-s">ALERT · AppDown</text>
        <rect x="248" y="332" width="58" height="22" rx="11" class="a-line"/>
        <text x="277" y="347" text-anchor="middle" class="a-text-s">pending</text>
        <rect x="312" y="332" width="58" height="22" rx="11" class="a-bad-f" fill-opacity="0.3"/>
        <text x="341" y="347" text-anchor="middle" class="a-text-s">firing</text>
        <rect x="376" y="332" width="64" height="22" rx="11" class="a-accent-s"/>
        <text x="408" y="347" text-anchor="middle" class="a-text-s">cleared</text>
        <text x="343" y="378" text-anchor="middle" class="a-text-s">the process dies, then returns</text>
      </g>

      <g transform="translate(0 -16)">
        <text x="250" y="428" text-anchor="middle" class="a-text">CHANGES THAT UNDO THEMSELVES</text>
        <path d="M80 482H412" class="a-dash"/>
        <g>
          <rect x="30" y="454" width="82" height="56" rx="10" class="a-body"/><text x="71" y="478" text-anchor="middle" class="a-text-s">01 applied</text><text x="71" y="496" text-anchor="middle" class="a-text-s">check ✓</text>
          <rect x="130" y="454" width="82" height="56" rx="10" class="a-body"/><text x="171" y="478" text-anchor="middle" class="a-text-s">02 applied</text><text x="171" y="496" text-anchor="middle" class="a-text-s">check ✓</text>
          <rect x="230" y="454" width="82" height="56" rx="10" class="a-body"/><rect x="230" y="454" width="82" height="56" rx="10" class="a-bad-f" fill-opacity="0.3"/><text x="271" y="478" text-anchor="middle" class="a-text-s">03 applied</text><text x="271" y="496" text-anchor="middle" class="a-text-s">check ✗</text>
          <rect x="330" y="454" width="82" height="56" rx="10" class="a-body"/><text x="371" y="478" text-anchor="middle" class="a-text-s">03 reverted</text><text x="371" y="496" text-anchor="middle" class="a-text-s">byte for byte</text>
        </g>
        <path d="M112 482h18M212 482h18M312 482h18" class="a-accent-s"/>
      </g>
    </svg>`,
  },

  principles: {
    lead: ['Built so that a bad day', 'is a boring day.'],
    items: [
      ['check', 'Ships only what it verified'],
      ['database', 'Restores before it trusts'],
      ['eye', 'Notices when it breaks'],
      ['refresh', 'Undoes what it changed'],
    ],
  },

  tour: {
    eyebrow: 'A tour of the whole thing',
    title: ['Five things that go wrong', 'on the way to production.'],
    text: 'Pick a tab. The output below is recorded from the running stack with fictional data; CI records it again and fails if it ever stops being true.',
    tag: 'Recorded output',
    tabs: [
      {
        id: 'ship',
        label: 'Ship',
        icon: 'box',
        title: 'A release goes live only after it earned it.',
        text: 'The files are copied and checked against their manifest, the secrets file must be private, the schema must be ahead of the code, the candidate must answer on the idle slot with the right version, and nginx must accept the new configuration. Then the edge is checked from the outside. Any step can refuse, and a refusal leaves the old release serving.',
        lab: 'lab.html#ship',
        transcript: (window.TRANSCRIPTS || {}).ship || '',
      },
      {
        id: 'backups',
        label: 'Backups',
        icon: 'database',
        title: 'A backup is a file until somebody restores it.',
        text: 'Every dump has a checksum and the row count of each table. The drill restores it into a scratch database, compares, and drops the scratch database. A copy with one flipped byte fails on its checksum before anything is restored.',
        lab: 'lab.html#backups',
        transcript: (window.TRANSCRIPTS || {}).backups || '',
      },
      {
        id: 'alerts',
        label: 'Alerts',
        icon: 'eye',
        title: 'The alert fires when the service dies, and clears when it returns.',
        text: 'Prometheus scrapes the sample service and the delivery machinery. Five rules, each with a unit test of when it fires and when it stays quiet. The lab stops the live process and you watch AppDown go from quiet to pending to firing.',
        lab: 'lab.html#alerts',
        transcript: (window.TRANSCRIPTS || {}).alerts || '',
      },
      {
        id: 'drift',
        label: 'Drift',
        icon: 'git',
        title: 'The server is what the repository says, or the difference has a name.',
        text: 'The live configuration is compared with the one the repository owns: modified, missing, extra. Sync puts the repository’s version back and keeps a copy of everything it replaced.',
        lab: 'lab.html#drift',
        transcript: (window.TRANSCRIPTS || {}).drift || '',
      },
      {
        id: 'undo',
        label: 'Undo',
        icon: 'refresh',
        title: 'A change that fails its own check takes itself back.',
        text: 'Numbered stages back up what they touch, make the change, then run their own check. If it fails, everything goes back and the result says why. Reverting is proven too: every file has to be byte for byte what it was.',
        lab: 'lab.html#undo',
        transcript: (window.TRANSCRIPTS || {}).undo || '',
      },
    ],
    modulesTitle: 'Everything in the box.',
    modulesNote: 'Each part has its own tests and a place in the lab',
    modules: [
      ['check', 'ops/deploy.sh', 'Copy, verify the copy, secrets mode, migrations, candidate on the idle slot, health gate, nginx -t, reload, verify through the edge, commit, drain. Every step can refuse, and every decision is one line of history.'],
      ['database', 'ops/backup.sh', 'A dump with its checksum and per-table row counts, a restore drill into a scratch database, rotation. Next to it, migrate.sh keeps migrations in a plain table, one transaction each; a release that needs one is refused until it has run.'],
      ['eye', 'prometheus/', 'Five alert rules, each with a promtool unit test of when it fires and when it does not, scraping the sample service and the control API’s own record of what the delivery machinery decided.'],
      ['git', 'ops/drift.sh', 'Compares the live configuration with the one the repository owns, file by file: modified, missing, extra. Sync restores the repository’s version and keeps a copy of what it replaced.'],
      ['refresh', 'ops/stage.sh', 'Numbered changes to a machine that back up what they touch, run their own check, and take themselves back when it fails. Reverting is proven byte for byte, newest stage first.'],
      ['server', 'src/', 'The control API. Fastify 5 and zod in strict TypeScript. It runs the scripts through an allow-list with no shell, serves this site, exports metrics, and refuses foreign Host and Origin headers. The lab exists only when asked for, never in production.'],
    ],
    transparency: {
      strong: 'Honest about the demo.',
      text: 'One container plays “a server”: nginx, the control API and the release processes share it, the way they would share a VPS. The sample service is trivial on purpose. The firewall script only prints rules; it was never applied to a live netfilter. The Terraform module and the Helm chart are validated, not applied, and ArgoCD is not built. The lab has no login, so it refuses to start in production. The limitations list in the README is complete.',
    },
  },

  challenges: {
    eyebrow: 'The hard parts',
    title: ['Go on,', 'try to ship something broken.'],
    text: 'These are seven things that are easy to claim and hard to get right. Each has a recipe, what you should see, and a button that opens the lab on that exact tab.',
    items: [
      {
        label: 'Ship something broken',
        icon: 'box',
        access: 'Lab · Ship',
        title: 'Ship a release that cannot reach its database.',
        text: 'A green build is not a working release.',
        steps: [
          'In <code>Ship</code>, press “v2 · 1.1.0” and wait for it.',
          'Press “v3 · cannot reach its database”.',
          'Read the history, and the line that says what is serving now.',
          'Press “v4 · needs a migration”, then “Apply the pending migration”, then “v4” again.',
        ],
        expect: 'The third release ends <code>unhealthy</code> (exit 13) after its candidate failed the health check; the history says <code>refused</code>, the edge still answers 1.1.0, and nothing of the refused release is left on disk. The fourth is <code>migrations_pending</code> (exit 12) until the migration has run, and ships after it.',
        lab: 'lab.html#ship',
      },
      {
        label: 'Ship a bad config',
        icon: 'cog',
        access: 'Lab · Ship',
        title: 'Break the web server’s configuration with a release.',
        text: 'The commonest outage is a change nobody ran through the validator.',
        steps: [
          'In <code>Ship</code>, make sure a release is serving (press “v2 · 1.1.0”).',
          'Press “v5 · invalid nginx snippet”.',
          'Look at the answer and at what is serving now.',
        ],
        expect: '<code>nginx_invalid</code> (exit 14). The message names the directive nginx rejected, the previous configuration is back, and the edge keeps answering with the old version. The invalid file never reached the running server.',
        lab: 'lab.html#ship',
      },
      {
        label: 'Tamper with the package',
        icon: 'fingerprint',
        access: 'Lab · Ship',
        title: 'Change a file after the manifest was written.',
        text: 'What was checked has to be what runs.',
        steps: [
          'In <code>Ship</code>, press “Ship v1 with a file edited”, then “Ship v1 with an extra file”.',
          'Press “Make the secrets file world-readable”, then “v2 · 1.1.0”.',
          'Press “Make it private again” and ship v2 once more.',
        ],
        expect: 'Both packages are refused with <code>artifact_unverified</code> (exit 10), one for a checksum and one for a file the manifest never listed. The world-readable secrets file stops the deploy with <code>env_permissions</code> (exit 11) before anything starts, and the same deploy works once the mode is 600.',
        lab: 'lab.html#ship',
      },
      {
        label: 'Lose the data',
        icon: 'database',
        access: 'Lab · Backups',
        title: 'Restore a backup, then restore a damaged one.',
        text: 'A backup nobody has restored is a hope.',
        steps: [
          'In <code>Backups</code>, press “Take a backup”, then “Drill” on it.',
          'Press “Damage a copy” on the same row, then “Drill” on the damaged copy.',
          'Take a few more and press “Keep the newest 2”.',
        ],
        expect: 'The first drill restores into a scratch database and reports that every table has the rows it had (<code>orders: 1000</code>). The damaged copy fails <code>checksum_mismatch</code> (exit 20) before anything is restored, and in <code>Alerts</code> the rule <code>RestoreDrillFailing</code> fires until a drill succeeds again. Rotation keeps exactly what it was asked to.',
        lab: 'lab.html#backups',
      },
      {
        label: 'Kill the service',
        icon: 'eye',
        access: 'Lab · Alerts',
        title: 'Stop the live process and wait for the alert.',
        text: 'Monitoring that has never fired is a guess.',
        steps: [
          'In <code>Alerts</code>, press “Stop the live process”.',
          'Watch <code>AppDown</code> go from quiet to pending to firing (about twenty seconds).',
          'Press “Start it again” and watch it clear.',
        ],
        expect: 'The edge answers 502 while the process is down. AppDown becomes <code>firing</code> after fifteen seconds of failed scrapes and goes quiet again within a few seconds of the restart. The rule and its unit test are in <code>prometheus/</code>.',
        lab: 'lab.html#alerts',
      },
      {
        label: 'Edit the server by hand',
        icon: 'git',
        access: 'Lab · Drift',
        title: 'Fix something on the server at 3 a.m. and see what the repository thinks.',
        text: 'Every hand edit is a lie somebody will believe later.',
        steps: [
          'In <code>Drift</code>, press “Edit the backup timer”, “Delete the security headers” and “Add a leftover file”.',
          'Press “Check”.',
          'Press “Sync”, then “Check” again.',
        ],
        expect: 'Three differences, each with a name: <code>modified</code>, <code>missing</code>, <code>extra</code>. Sync puts the repository’s version back and keeps a copy of everything it replaced under <code>backups/drift-…</code>. The second check is clean.',
        lab: 'lab.html#drift',
      },
      {
        label: 'Make a change that fails',
        icon: 'refresh',
        access: 'Lab · Undo',
        title: 'Apply a hardening step whose own check fails.',
        text: 'The riskiest change is the one that looks safe.',
        steps: [
          'In <code>Undo</code>, press “Make the service unwell”.',
          'Press “Apply” on stage 03.',
          'Press “Make the service well”, apply 01 and 02, then “Revert everything”.',
        ],
        expect: 'Stage 03 changes a setting, runs its check, sees the service unwell and <code>reverts itself</code> (exit 31): the answer says why and the stage is listed as available again. After a good run, “Revert everything” undoes the stages newest first and checks that every file is byte for byte what it was.',
        lab: 'lab.html#undo',
      },
    ],
  },

  run: {
    eyebrow: 'Run it in a minute',
    title: ['One command.', 'A whole delivery pipeline on localhost.'],
    text: 'You need Docker. There are no cloud accounts, no credentials and nothing to download besides the images; nothing leaves your machine.',
    steps: [
      ['terminal', 'Clone', 'git clone, then cd into the folder.'],
      ['play', 'Start', 'make up writes a .env with a fresh random database password, builds the image, starts PostgreSQL and Prometheus, and ships the first release.'],
      ['globe', 'Open', 'http://localhost:8100 is this page. Press “Enter the lab”.'],
      ['flask', 'Break it', 'Use the hard parts above, or run make smoke for thirty-four checks against the running stack, one of them an alert firing and clearing.'],
    ],
    terminal: {
      title: 'bash',
      lines: [
        '# 1. get the code',
        'git clone https://github.com/MenoDK/groundwork-devops.git',
        'cd groundwork-devops',
        '# 2. start the stack (builds a small image, creates .env, ships release 1.0.0)',
        'make up',
        '# 3. open http://localhost:8100 and press “Enter the lab”',
        '# optional: the same checks from a terminal',
        'make smoke',
      ],
    },
  },

  under: {
    eyebrow: 'Under the hood',
    title: ['A small surface,', 'serious edges.'],
    text: 'The interesting code is short on purpose. The decisions behind it are written down with the alternatives that lost.',
    stackTitle: 'What it is built with',
    stack: [
      { group: 'Language', items: ['Bash · set -euo pipefail · shellcheck clean', 'TypeScript 5 · strict', 'Node 22 · Fastify 5 · zod', 'one RESULT line per script'] },
      { group: 'Runtime', items: ['nginx · non-root · rate limited', 'PostgreSQL 15', 'Prometheus 2.55', 'a JSONL history of every decision'] },
      { group: 'Safety', items: ['execFile allow-list · no shell', 'Host and Origin checks', 'read-only root · no capabilities', 'lab refused in production'] },
      { group: 'Quality', items: ['bats · real nginx, real PostgreSQL', 'vitest · promtool unit tests', 'Playwright + axe', 'a sabotage script that must be caught'] },
      { group: 'Delivery', items: ['Multi-stage Dockerfile, non-root', 'Compose, health-gated', 'GitHub Actions · pinned gitleaks', 'Terraform and Helm · new, validated not applied'] },
    ],
    proofTitle: 'What is measured, and the records behind it',
    numbers: [
      ['57', 'shell tests against a real nginx and a real PostgreSQL'],
      ['40', 'sabotages of a gate, each caught by the test that guards it'],
      ['34', 'checks on the running stack, one of them an alert firing and clearing'],
      ['6', 'decision records, each with rejected alternatives'],
    ],
    decisions: [
      ['Verify the copy, not the source', 'ADR 0001: why the files that are checked are the files that will run.', 'docs/adr/0001-verify-the-copy-not-the-source.md'],
      ['Two slots and a symlink', 'ADR 0002: why a release switch is a reload, and what a process manager would add.', 'docs/adr/0002-two-slots-and-a-symlink.md'],
      ['A backup is proven by restoring it', 'ADR 0003: the drill, the checksum, and what neither can tell you.', 'docs/adr/0003-a-backup-is-proven-by-restoring-it.md'],
      ['Changes that take themselves back', 'ADR 0004: stages, their own check, and the revert that is itself verified.', 'docs/adr/0004-changes-that-take-themselves-back.md'],
    ],
    measuredOn: 'Measured on 2026-11-05. Counts come from the commands in the README, not from memory.',
    future: [
      ['Apply the Terraform module to a real account', 'validated here, never applied.'],
      ['A VM instead of a directory for the stages', 'so the hardening steps run against a real /etc.'],
      ['ArgoCD on the Helm chart', 'a pull-based deploy with its own drift detection.'],
      ['Alertmanager and a pager', 'routing, silencing and escalation for the five rules.'],
    ],
  },

  about: {
    why: 'Groundwork is the operations side of my work: putting software on a server and being able to say, with evidence, why it is safe to keep running. The ideas come from deploys I have written and run; the code in this repository is written fresh, tested, and breakable on purpose.',
  },

  faq: [
    ['Why bash for the delivery core?', 'Because the job is orchestrating nginx, processes, pg_dump and files, and a script that prints one JSON line is the smallest thing that does it. Every script is tested against a real nginx and a real PostgreSQL, shellcheck gates every change, and the control API on top is typed. ADR 0005 has the alternatives.'],
    ['Is that really zero downtime?', 'For a release that replaces another one, a test sends 120 requests while it switches and requires every one to be a 200. The very first release has nothing to replace. I saw one 502 right after the first-ever deploy and could not reproduce it in 600 requests; the likeliest cause is the reload window of that first deploy, which I have not proven. The README lists it.'],
    ['Does it deploy to a real server?', 'No. One container plays the server so you can break it safely. The order of the gates is the one you would use on a VPS, and a manual GitHub Actions workflow shows how the same scripts would be called over SSH; it is written, guarded by a repository variable, and has never run against a real host.'],
    ['What about Kubernetes and the cloud?', 'There is a Helm chart (rolling update with no unavailable pods, a readiness probe, a disruption budget, a network policy, a hardened pod) and a Terraform module for an AWS host. Both are validated with helm lint, kubeconform and terraform validate and are labelled new; neither was applied to a cluster or an account.'],
    ['Can the lab mode reach production?', 'No. The API refuses to start with GW_LAB set when GW_ENV is production, a test pins that, and without the flag every lab endpoint answers 404. It also refuses any Host or Origin it does not own, because a local tool with no login must not be drivable by a web page.'],
    ['Is the firewall script safe to run?', 'It only prints. Docker publishes ports through NAT, so a UFW rule filters nothing for them; the rules belong in the DOCKER-USER chain, and ADR 0006 explains why. The script refuses a short allow-list instead of printing rules that would lock a CDN out. It was not applied to a live netfilter here.'],
  ],

  closing: {
    eyebrow: 'Your turn',
    title: ['Try to ship', 'something broken.'],
    button: 'Open the lab',
    fine: 'Local only · fictional data · nothing is sent anywhere',
  },
};
