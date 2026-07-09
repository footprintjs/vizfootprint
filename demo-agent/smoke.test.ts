/**
 * Playwright smoke for the mixed-principal demo — real headless Chromium (the
 * pinned chrome-headless-shell 1208 the repo's demo also uses), the scripted
 * MOCK provider (no API calls). Proves the ONE page renders BOTH panes, that a
 * human brush and a mock chat turn both land in the SAME commit log (a `user`
 * chip AND an `agent` chip), that the declared correlation lands a ledger row,
 * and that the page runs with ZERO console errors. Screenshots the page.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from './server.mjs';

const CHROME =
  '/Users/sanjay/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'screenshots');

async function brush(page: Page, fromFrac: number, toFrac: number): Promise<void> {
  const box = await page.locator('svg.scatter').boundingBox();
  if (!box) throw new Error('scatter not found');
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((fromFrac + toFrac) / 2), y, { steps: 6 });
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 6 });
  await page.mouse.up();
}

describe.skipIf(!existsSync(CHROME))('demo-agent smoke (real headless Chromium, mock provider)', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startServer({ port: 0, mock: true });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await handle?.close();
  });

  it('renders both panes; a human brush + a mock chat turn share one commit log', async () => {
    await page.goto(handle.url);

    // both panes render
    await page.waitForSelector('#dashboard svg.scatter');
    await page.waitForSelector('#dashboard svg.bar');
    await page.waitForSelector('#chat .composer input');
    expect(await page.locator('#chat .composer input').count()).toBe(1);

    // the human moves first → exactly one USER chip, no agent chip yet
    await brush(page, 0.22, 0.72);
    await page.waitForSelector('[data-chip]');
    await page.waitForFunction(() => document.querySelectorAll('[data-chip] [data-actor="user"]').length >= 1);
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBe(0);

    // the analyst works alongside — send a message through the real composer
    await page.locator('#chat .composer input').fill('Is price correlated with rating? Declare it and read the ledger honestly.');
    await page.locator('#chat .composer input').press('Enter');

    // the mock drives whats_here → filter → declare correlation: an AGENT chip appears
    await page.waitForFunction(() => document.querySelectorAll('[data-chip] [data-actor="agent"]').length >= 1, undefined, { timeout: 20_000 });
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    // both principals are now in the one log
    expect(await page.locator('[data-chip] [data-actor="user"]').count()).toBeGreaterThanOrEqual(1);

    // the declared correlation landed exactly one online-FDR ledger row
    await page.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length >= 1, undefined, { timeout: 20_000 });
    expect(await page.locator('table.ledger tbody tr').count()).toBe(1);

    // the analyst's reply bubble arrived
    await page.waitForSelector('.bubble.analyst');
    expect((await page.locator('.bubble.analyst').first().textContent())?.length ?? 0).toBeGreaterThan(20);

    await page.screenshot({ path: path.join(SHOTS, 'analyst-agent.png'), fullPage: true });
  }, 60_000);

  it('the page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
