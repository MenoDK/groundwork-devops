import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { active, cards, leaveSplash, named, openLab, resetServer, watch } from './helpers';

// Every deliberate refusal is a non-2xx fetch, which Chromium logs as a console error. The edge answering 502 while the
// live process is stopped is one of them; these are the ones the lab provokes.
const DELIBERATE = [403, 404, 409, 422, 502];
// A candidate that never becomes healthy is given twenty seconds before it is refused.
const SLOW = { timeout: 45_000 };

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const press = (page: Page, name: string) => active(page).getByRole('button', { name, exact: true }).first().click();
const newest = (page: Page) => cards(page).first();
const row = (page: Page, text: string | RegExp) => active(page).getByRole('listitem').filter({ hasText: text });

test.describe('lab: ship', () => {
  test('a release that cannot reach its database is refused, and the old one keeps serving', async ({ page }) => {
    const problems = watch(page, { allowStatus: DELIBERATE });
    await openLab(page, 'Ship');
    await expect(active(page)).toContainText('1.1.0 (v2)');
    await press(page, 'v3 · cannot reach its database');
    await expect(newest(page)).toContainText('refused · exit 13', SLOW);
    await expect(newest(page)).toContainText('unhealthy');
    await expect(active(page)).toContainText('1.1.0 (v2)'); // what is serving did not change
    await expect(row(page, 'v3-no-database')).toContainText('refused');
    expect(problems).toEqual([]);
  });

  test('a release with an invalid nginx snippet never reaches the running server', async ({ page }) => {
    await openLab(page, 'Ship');
    await press(page, 'v5 · invalid nginx snippet');
    await expect(newest(page)).toContainText('refused · exit 14', SLOW);
    await expect(newest(page)).toContainText('nginx_invalid');
    await expect(newest(page)).toContainText('unknown directive');
    await expect(active(page)).toContainText('1.1.0 (v2)');
  });

  test('a package changed after its manifest was written is refused, whichever way it was changed', async ({
    page,
  }) => {
    await openLab(page, 'Ship');
    await press(page, 'Ship v1 with a file edited');
    await expect(newest(page)).toContainText('refused · exit 10');
    await expect(newest(page)).toContainText('a file does not match its checksum');
    await press(page, 'Ship v1 with an extra file');
    await expect(newest(page)).toContainText('refused · exit 10');
    await expect(newest(page)).toContainText('artifact_unverified');
    await expect(active(page)).toContainText('1.1.0 (v2)');
  });

  test('a world-readable secrets file stops the deploy, and the same deploy works once it is private', async ({
    page,
  }) => {
    await openLab(page, 'Ship');
    await press(page, 'Make the secrets file world-readable');
    await press(page, 'v2 · 1.1.0');
    await expect(newest(page)).toContainText('refused · exit 11');
    await expect(newest(page)).toContainText('env_permissions');
    await expect(newest(page)).toContainText('must be 600');
    await press(page, 'Make it private again');
    await press(page, 'v2 · 1.1.0');
    await expect(newest(page)).toContainText('done');
    await expect(newest(page)).toContainText('v2 1.1.0 is serving');
  });

  test('a release that needs a migration waits for it, and ships once it has run', async ({ page }) => {
    // The database outlives the page, so the migration may already have run in an earlier test or an earlier run. Either
    // outcome is checked for what it is; the strict "refused until it has run" ordering on an empty database is pinned by
    // the shell tests (deploy.bats), which start from one every time.
    await openLab(page, 'Ship');
    await press(page, 'v4 · needs a migration');
    await expect(newest(page)).toContainText(/refused · exit 12|done/, SLOW);
    if ((await newest(page).innerText()).includes('exit 12')) {
      await expect(newest(page)).toContainText('migrations_pending');
      await expect(active(page)).toContainText('1.1.0 (v2)'); // still the old release
      await press(page, 'Apply the pending migration');
      await expect(newest(page)).toContainText('done');
      await press(page, 'v4 · needs a migration');
    }
    await expect(newest(page)).toContainText('done', SLOW);
    await expect(active(page)).toContainText('1.3.0 (v4-orders-status)');
  });

  test('rolling back returns to the previous release', async ({ page }) => {
    await openLab(page, 'Ship');
    await press(page, 'v1 · 1.0.0');
    await expect(newest(page)).toContainText('done', SLOW);
    await expect(active(page)).toContainText('1.0.0 (v1)');
    await press(page, 'Roll back');
    await expect(newest(page)).toContainText('done', SLOW);
    await expect(active(page)).toContainText('1.1.0 (v2)');
  });

  test('“Start over” puts the secrets file, the process and the configuration back', async ({ page }) => {
    await openLab(page, 'Ship');
    await press(page, 'Make the secrets file world-readable');
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Back to a clean slate')).toBeVisible();
    await press(page, 'v2 · 1.1.0');
    await expect(newest(page)).toContainText('done');
  });
});

test.describe('lab: backups', () => {
  test('a backup restores into a scratch database, and a damaged copy is caught before anything is restored', async ({
    page,
  }) => {
    const problems = watch(page, { allowStatus: DELIBERATE });
    await openLab(page, 'Backups');
    await press(page, 'Take a backup');
    await expect(newest(page)).toContainText('done');
    await expect(row(page, 'original').first()).toContainText('orders: 1000');

    await row(page, 'original').first().getByRole('button', { name: 'Drill' }).click();
    await expect(newest(page)).toContainText('every table has the rows it had');

    await row(page, 'original').first().getByRole('button', { name: 'Damage a copy' }).click();
    await expect(row(page, 'damaged copy').first()).toBeVisible();
    await row(page, 'damaged copy').first().getByRole('button', { name: 'Drill' }).click();
    await expect(newest(page)).toContainText('refused · exit 20');
    await expect(newest(page)).toContainText('checksum_mismatch');
    expect(problems).toEqual([]);
  });

  test('rotation keeps exactly the number of backups it was asked to', async ({ page }) => {
    await openLab(page, 'Backups');
    for (let i = 0; i < 3; i += 1) {
      await press(page, 'Take a backup');
      await expect(newest(page)).toContainText('done');
      await page.waitForTimeout(1100); // file names carry the second they were taken
    }
    await press(page, 'Keep the newest 2');
    await expect(newest(page)).toContainText('done');
    await expect(row(page, 'original')).toHaveCount(2);
  });
});

test.describe('lab: alerts', () => {
  test('both scrape targets are up, all five rules are listed, and the one about the service is quiet', async ({
    page,
  }) => {
    await openLab(page, 'Alerts');
    await expect(named(page, 'control')).toContainText('up', { timeout: 30_000 });
    await expect(named(page, 'app')).toContainText('up');
    for (const name of [
      'AppDown',
      'DeploysKeepBeingRefused',
      'BackupStale',
      'RestoreDrillFailing',
      'ConfigurationDrift',
    ]) {
      await expect(named(page, name)).toBeVisible();
    }
    await expect(named(page, 'AppDown')).toContainText('quiet');
  });

  test('stopping the live process makes the edge answer 502 and fires AppDown; starting it clears the alert', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000); // fifteen seconds of failed scrapes to fire, a few to clear, and the page polls every three
    const problems = watch(page, { allowStatus: DELIBERATE });
    await openLab(page, 'Alerts');
    await expect(named(page, 'control')).toContainText('up', { timeout: 30_000 });
    await press(page, 'Stop the live process');
    await expect(newest(page)).toContainText('done');
    expect((await request.get('/app/version')).status()).toBe(502);
    await expect(named(page, 'AppDown')).toContainText('firing', { timeout: 60_000 });
    await expect(active(page)).toContainText('AppDown: ');

    await press(page, 'Start it again');
    await expect(named(page, 'AppDown')).toContainText('quiet', { timeout: 60_000 });
    expect((await request.get('/app/version')).status()).toBe(200);
    expect(problems).toEqual([]);
  });

  test('a failed restore drill fires RestoreDrillFailing, and a good one clears it', async ({ request }) => {
    test.setTimeout(240_000); // Prometheus evaluates every five seconds and the rule has to see the change twice
    type Backup = { file: string; damaged: boolean };
    const post = async (path: string, data: object) => (await request.post(path, { data })).json();
    const backups = async () => ((await (await request.get('/api/backups')).json()) as { backups: Backup[] }).backups;
    const state = async () => {
      const body = (await (await request.get('/api/alerts')).json()) as { alerts: { name: string }[] };
      return body.alerts.some((a) => a.name === 'RestoreDrillFailing') ? 'firing' : 'quiet';
    };

    expect((await post('/api/lab/backups/take', {})).ok).toBe(true);
    const original = (await backups()).find((b) => !b.damaged)?.file ?? '';
    expect(original).not.toBe('');
    await post('/api/lab/backups/damage', { file: original });
    const damaged = (await backups()).find((b) => b.damaged)?.file ?? '';
    expect(damaged).not.toBe('');

    expect((await post('/api/lab/backups/drill', { file: damaged })).exitCode).toBe(20);
    await expect.poll(state, { timeout: 90_000, intervals: [3_000] }).toBe('firing');
    expect((await post('/api/lab/backups/drill', { file: original })).ok).toBe(true);
    await expect.poll(state, { timeout: 90_000, intervals: [3_000] }).toBe('quiet');
  });

  test('what the control API exports is shown as text', async ({ page }) => {
    await openLab(page, 'Alerts');
    await press(page, 'What the control API exports');
    await expect(newest(page)).toContainText('gw_');
  });
});

test.describe('lab: drift', () => {
  test('three hand edits show up as modified, missing and extra, and a sync takes them back', async ({ page }) => {
    await openLab(page, 'Drift');
    await expect(active(page)).toContainText('clean');
    await press(page, 'Edit the backup timer');
    await press(page, 'Delete the security headers');
    await press(page, 'Add a leftover file');
    await press(page, 'Check');
    await expect(active(page)).toContainText('drifted');
    await expect(row(page, 'systemd/groundwork-backup.timer')).toContainText('modified');
    await expect(row(page, 'nginx/security-headers.conf')).toContainText('missing');
    await expect(row(page, 'nginx/leftover.conf')).toContainText('extra');

    await press(page, 'Sync');
    await expect(active(page)).toContainText('removed (a copy is kept)');
    await expect(active(page)).toContainText('restored from the repository');
    await press(page, 'Check');
    await expect(active(page)).toContainText('Every file the repository owns is on the server');
  });
});

test.describe('lab: undo', () => {
  test('a stage whose own check fails takes itself back, and the others can be applied and reverted', async ({
    page,
  }) => {
    await openLab(page, 'Undo');
    await press(page, 'Make the service unwell');
    await row(page, '03').getByRole('button', { name: 'Apply' }).click();
    await expect(newest(page)).toContainText('refused · exit 31');
    await expect(newest(page)).toContainText('verification_failed');
    await expect(row(page, '03')).toContainText('available'); // it is not left half applied

    await press(page, 'Make the service well');
    for (const n of ['01', '02', '03']) {
      await row(page, n).getByRole('button', { name: 'Apply' }).click();
      await expect(row(page, n)).toContainText('applied');
    }
    await press(page, 'Revert everything');
    await expect(newest(page)).toContainText('byte-for-byte');
    for (const n of ['01', '02', '03']) await expect(row(page, n)).toContainText('available');
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility: every lab tab has no WCAG A/AA violations (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const name of ['Ship', 'Backups', 'Alerts', 'Drift', 'Undo']) {
      // A page per tab, the way a visitor arrives from the landing page's links: changing only the #hash of an open page
      // does not reload it, and the lab reads the hash when it loads.
      const page = await context.newPage();
      await page.goto(`/lab.html#${name.toLowerCase()}`);
      await leaveSplash(page);
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await expect(active(page).locator('.box').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        results.violations.map((v) => `${name}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
    }
    await context.close();
  });
}
