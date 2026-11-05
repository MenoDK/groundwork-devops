import { type APIRequestContext, type Page, expect } from '@playwright/test';

const BASE = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:8100');

/** Collects what would make a reviewer frown: console errors, page errors (CSP violations land here) and third-party calls. */
export function watch(page: Page, { allowStatus = [] as number[] } = {}): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Chromium logs every non-2xx fetch as an error. The lab provokes some on purpose; allow only the listed ones.
    const status = /status of (\d{3})/.exec(m.text());
    if (status && allowStatus.includes(Number(status[1]))) return;
    problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.host !== BASE.host) {
      problems.push(`third-party request: ${r.url()}`);
    }
  });
  return problems;
}

export async function leaveSplash(page: Page): Promise<void> {
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 10_000 });
}

/** Open the lab on a tab and wait until it is there. There is no sign-in: the lab is a local tool. */
export async function openLab(page: Page, name: string): Promise<void> {
  await page.goto(`/lab.html#${name.toLowerCase()}`);
  await leaveSplash(page);
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/** The tab panel that is open. Panels that were visited and left stay in the page, hidden, so every locator starts here. */
export const active = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])');

/** The answer and result cards in the open tab, newest first. */
export const cards = (page: Page) => active(page).locator('.box.arrive');

/** The list item whose bold name is exactly `name` ("app" would otherwise match "AppDown" as a substring). */
export const named = (page: Page, name: string) =>
  active(page)
    .getByRole('listitem')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });

type Answer = { ok: boolean; exitCode?: number; result?: string };

async function post(request: APIRequestContext, path: string, data: object): Promise<Answer> {
  const res = await request.post(path, { data });
  return (await res.json()) as Answer;
}

/**
 * Put the server back to a known state: secrets file private, the process running, the configuration synced, the
 * stages reverted and release 1.1.0 serving. A refused deploy leaves the previous release serving, so the tests that
 * provoke refusals all start from here.
 */
export async function resetServer(request: APIRequestContext): Promise<void> {
  expect((await request.post('/api/lab/env-mode', { data: { mode: '600' } })).ok()).toBeTruthy();
  await request.post('/api/lab/app', { data: { action: 'start' } }); // already running is fine
  expect((await request.post('/api/lab/drift/sync', { data: {} })).ok()).toBeTruthy();
  expect((await request.post('/api/lab/stages/health', { data: { value: 'ok' } })).ok()).toBeTruthy();
  expect((await request.post('/api/lab/stages/revert', { data: { n: 'all' } })).ok()).toBeTruthy();
  const shipped = await post(request, '/api/lab/ship', { variant: 'v2' });
  expect(shipped.ok, `shipping v2 answered ${JSON.stringify(shipped)}`).toBeTruthy();
  // Wait for the edge to answer with the release that was just shipped: the reload is quick, not instant.
  await expect
    .poll(async () => (await (await request.get('/app/version')).json()).version, { timeout: 20_000 })
    .toBe('1.1.0');
}
