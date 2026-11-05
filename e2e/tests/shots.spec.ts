import { type Page, expect, test } from '@playwright/test';
import { active, leaveSplash, named, openLab, resetServer } from './helpers';

// Only with SHOTS=1 (`make screenshots`): these are the pictures in the README, taken from the real server.
test.skip(process.env.SHOTS !== '1', 'screenshots are taken on request');
test.use({ viewport: { width: 1360, height: 860 }, colorScheme: 'light', contextOptions: { reducedMotion: 'reduce' } });

const OUT = process.env.SHOTS_DIR ?? '../docs/img';
// A candidate that never becomes healthy is given twenty seconds before it is refused.
const SLOW = { timeout: 45_000 };
const press = (page: Page, name: string) => active(page).getByRole('button', { name, exact: true }).first().click();
const settle = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 0)); // clicking scrolled the page; the picture starts at the top
  await page.waitForTimeout(5000); // let the confirmation toast leave
};

test('landing', async ({ page }) => {
  await page.goto('/?lang=en');
  await leaveSplash(page);
  await page.screenshot({ path: `${OUT}/landing.png` });
});

test('lab: three releases that must be refused, and the one that keeps serving', async ({ page, request }) => {
  test.setTimeout(180_000);
  await resetServer(request);
  await openLab(page, 'Ship');
  await press(page, 'v3 · cannot reach its database');
  await expect(active(page)).toContainText('exit 13', SLOW);
  await press(page, 'v5 · invalid nginx snippet');
  await expect(active(page)).toContainText('exit 14', SLOW);
  await press(page, 'Ship v1 with a file edited');
  await expect(active(page)).toContainText('exit 10', SLOW);
  await page.setViewportSize({ width: 1360, height: 1500 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lab-ship.png` });
});

test('lab: a backup that restores, and a damaged copy that does not', async ({ page, request }) => {
  await resetServer(request);
  await openLab(page, 'Backups');
  await press(page, 'Take a backup');
  await press(page, 'Drill');
  await expect(active(page)).toContainText('orders: 1000');
  await press(page, 'Damage a copy');
  await active(page)
    .getByRole('listitem')
    .filter({ hasText: 'damaged copy' })
    .getByRole('button', { name: 'Drill' })
    .first()
    .click();
  await expect(active(page)).toContainText('exit 20');
  await page.setViewportSize({ width: 1360, height: 1500 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lab-backups.png` });
});

test('lab: AppDown goes from quiet to firing and back', async ({ page, request }) => {
  test.setTimeout(240_000);
  await resetServer(request);
  await openLab(page, 'Alerts');
  await expect(named(page, 'control')).toContainText('up', { timeout: 30_000 });
  await press(page, 'Stop the live process');
  await expect(named(page, 'AppDown')).toContainText('firing', { timeout: 60_000 });
  await page.setViewportSize({ width: 1360, height: 1400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/lab-alerts-firing.png` });
  await press(page, 'Start it again');
  await resetServer(request);
});

test('lab: a stage whose own check fails takes itself back', async ({ page, request }) => {
  await resetServer(request);
  await openLab(page, 'Undo');
  await press(page, 'Make the service unwell');
  await active(page).getByRole('listitem').filter({ hasText: '03' }).getByRole('button', { name: 'Apply' }).click();
  await expect(active(page)).toContainText('exit 31');
  await page.setViewportSize({ width: 1360, height: 1300 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lab-undo.png` });
  await resetServer(request);
});
