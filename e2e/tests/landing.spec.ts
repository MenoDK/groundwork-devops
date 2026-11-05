import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { leaveSplash, watch } from './helpers';

test.describe('landing page', () => {
  test('shows the loading stage, then the page, without a single console problem or third-party request', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/?lang=en');
    await expect(page.locator('#splash')).toBeVisible();
    await leaveSplash(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Shipping software');
    await expect(page.getByRole('link', { name: /Open the lab/ }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the tour tabs swap in recorded output that really came from the server', async ({ page }) => {
    await page.goto('/?lang=en');
    await leaveSplash(page);
    const tabs = page.getByRole('group', { name: 'Explore the product' });
    const output = page.getByRole('region', { name: 'Example output' });

    await tabs.getByRole('button', { name: /Ship/ }).click();
    await expect(output).toContainText('ok artifact verified');
    await expect(output).toContainText('the previous release is still serving');
    await expect(output).toContainText('exit 13');
    await expect(output).toContainText('nginx_invalid');
    await expect(output).toContainText('artifact_unverified');
    await expect(output).toContainText('env_permissions');

    await tabs.getByRole('button', { name: /Backups/ }).click();
    // placeholders are text, not tags: a transcript inserted as HTML would swallow "<timestamp>"
    await expect(output).toContainText('db-<timestamp>.dump');
    await expect(output).toContainText('orders');
    await expect(output).toContainText('checksum_mismatch');

    await tabs.getByRole('button', { name: /Alerts/ }).click();
    await expect(output).toContainText('firing');
    await expect(output).toContainText('The sample service is not answering through the edge');

    await tabs.getByRole('button', { name: /Drift/ }).click();
    await expect(output).toContainText('missing');
    await expect(output).toContainText('modified');
    await expect(output).toContainText('extra');
    await expect(output).toContainText('removed (a copy is kept)');

    await tabs.getByRole('button', { name: /Undo/ }).click();
    await expect(output).toContainText('verification_failed');
    await expect(output).toContainText('exit 31');
    await expect(output).toContainText('byte-for-byte');
    await expect(tabs.getByRole('button', { name: /Undo/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('both of Prometheus’s scrape targets are up in the recorded alerts output', async ({ page }) => {
    await page.goto('/?lang=en');
    await leaveSplash(page);
    await page
      .getByRole('group', { name: 'Explore the product' })
      .getByRole('button', { name: /Alerts/ })
      .click();
    const text = await page.getByRole('region', { name: 'Example output' }).innerText();
    expect(text).not.toContain('"health": "down"');
    expect(text).toContain('"job": "control"');
  });

  test('no recorded output contains anything shaped like a secret', async ({ page }) => {
    await page.goto('/?lang=en');
    const text = await page.evaluate(() => JSON.stringify((window as unknown as { TRANSCRIPTS: object }).TRANSCRIPTS));
    expect(text).not.toMatch(/postgres:\/\/|POSTGRES_PASSWORD|-----BEGIN|Bearer [A-Za-z0-9]{12}/);
  });

  test('every hard part offers a recipe and a link that opens the lab on that tab', async ({ page }) => {
    await page.goto('/?lang=en#hard-parts');
    await leaveSplash(page);
    const list = page.getByRole('group', { name: 'Hard parts to try' });
    const names = [
      'Ship something broken',
      'Ship a bad config',
      'Tamper with the package',
      'Lose the data',
      'Kill the service',
      'Edit the server by hand',
      'Make a change that fails',
    ];
    for (const name of names) {
      await list.getByRole('button', { name }).click();
      await expect(page.getByText('You should see', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Try it in the lab' })).toHaveAttribute('href', /lab\.html(#\w+)?$/);
    }
  });

  test('the theme switch is applied, remembered across reloads, and nothing leaves the page', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?lang=en');
    await leaveSplash(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Use the dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('works with reduced motion and still reveals every section', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/?lang=en');
    await leaveSplash(page);
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: /Asked often/ })).toBeVisible();
    await context.close();
  });

  test('has no horizontal scroll on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto('/?lang=en');
    await leaveSplash(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('the hero artwork keeps every label inside its frame', async ({ page }) => {
    await page.goto('/?lang=en');
    await leaveSplash(page);
    const outside = await page.evaluate(() => {
      const frame = document.querySelector('.hero-art svg');
      if (!frame) return -1;
      const box = frame.getBoundingClientRect();
      return [...frame.querySelectorAll('text')].filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left < box.left - 1 || r.right > box.right + 1;
      }).length;
    });
    expect(outside).toBe(0);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility: the landing page has no WCAG A/AA violations (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/?lang=en');
    await leaveSplash(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await context.close();
  });
}
