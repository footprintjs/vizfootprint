/**
 * Playwright smoke for the mixed-principal demo — real headless Chromium (the
 * pinned chrome-headless-shell 1208 the repo's demo also uses), the scripted
 * MOCK provider (no API calls). It proves the full dress-shop UX:
 *   - the dashboard renders FULL-WIDTH; a human brush lands a `user` commit;
 *   - the floating LAUNCHER opens the analyst chat POPUP (not a fixed column);
 *   - a mock chat turn lands an `agent` commit + one online-FDR ledger row in the
 *     SAME shared log, and produces a grounded reply;
 *   - the 🐛 button opens a CENTRAL MODAL iframing the isolated /debug?embed page,
 *     and atui's `.atui` / `.flowscene` root renders NON-zero width inside it —
 *     the dress-shop's exact regression check that the iframe CSS-isolation held;
 *   - ZERO console errors throughout.
 * Screenshots the dashboard, the open popup, and the open debugger modal.
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

  it('full-width dashboard + a human brush share one commit log with the popup analyst', async () => {
    await page.goto(handle.url);

    // the dashboard renders full-width; the chat is a launcher, NOT a fixed column
    await page.waitForSelector('#dashboard svg.scatter');
    await page.waitForSelector('#dashboard svg.bar');
    expect(await page.locator('#fab').isVisible()).toBe(true); // the "Ask the analyst" launcher
    expect(await page.locator('#chatpanel').isHidden()).toBe(true); // popup closed until launched

    // the human moves first → exactly one USER chip, no agent chip yet
    await brush(page, 0.22, 0.72);
    await page.waitForSelector('[data-chip]');
    await page.waitForFunction(() => document.querySelectorAll('[data-chip] [data-actor="user"]').length >= 1);
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, 'dashboard.png'), fullPage: true });

    // launch the popup — the composer lives inside it, not in a fixed pane
    await page.locator('#fab').click();
    await page.waitForSelector('#chatpanel:not([hidden]) .composer input');
    expect(await page.locator('#chatpanel .composer input').count()).toBe(1);

    // the analyst works alongside — send a message through the popup composer
    await page.locator('#chatpanel .composer input').fill('Is price correlated with rating? Declare it and read the ledger honestly.');
    await page.locator('#chatpanel .composer input').press('Enter');

    // the mock drives whats_here → filter → declare correlation: an AGENT chip appears
    await page.waitForFunction(() => document.querySelectorAll('[data-chip] [data-actor="agent"]').length >= 1, undefined, { timeout: 20_000 });
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    // both principals are now in the one log
    expect(await page.locator('[data-chip] [data-actor="user"]').count()).toBeGreaterThanOrEqual(1);

    // the declared correlation landed exactly one online-FDR ledger row
    await page.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length >= 1, undefined, { timeout: 20_000 });
    expect(await page.locator('table.ledger tbody tr').count()).toBe(1);

    // the analyst's reply bubble arrived (inside the popup)
    await page.waitForSelector('#chatpanel .bubble.analyst');
    expect((await page.locator('#chatpanel .bubble.analyst').first().textContent())?.length ?? 0).toBeGreaterThan(20);
    await page.screenshot({ path: path.join(SHOTS, 'analyst-popup.png'), fullPage: true });
  }, 60_000);

  it('the 🐛 button opens the debugger modal and atui renders NON-zero width in the iframe', async () => {
    // the 🐛 button sits under the analyst reply
    const dbgBtn = page.locator('#chatpanel .dbgbtn').first();
    await dbgBtn.waitFor({ timeout: 20_000 });
    await dbgBtn.click();

    // a central modal iframing the isolated /debug?embed page opens
    await page.waitForSelector('#dbgmodal:not([hidden]) #dbgframe');
    const frame = page.frameLocator('#dbgframe');

    // THE regression check: atui's root renders with real width — proving the host
    // dashboard's global CSS did NOT leak into the iframe and collapse its layout.
    const atui = frame.locator('.atui');
    await atui.waitFor({ timeout: 15_000 });
    const box = await atui.boundingBox();
    expect(box?.width ?? 0, 'atui root width must be > 0 (iframe isolation held)').toBeGreaterThan(0);
    const scene = await frame.locator('.flowscene').first().boundingBox();
    expect(scene?.width ?? 0, 'atui .flowscene width must be > 0').toBeGreaterThan(0);

    await page.screenshot({ path: path.join(SHOTS, 'debugger-modal.png'), fullPage: true });
  }, 60_000);

  it('the page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * Phase B — the dashboard TIME-TRAVEL bar (real headless Chromium, mock provider):
 *   - a timeline of the active branch's commits + a branch-map git-graph render;
 *   - brush → seek back (click a past commit) → brush again SPROUTS a second
 *     branch, and the old branch stays intact (2 lineages in the map);
 *   - a declared test's GLOBAL ledger count survives travelling back (never
 *     un-counted), and the two-truths honesty line is rendered verbatim;
 *   - ZERO console errors. Screenshots the visible fork.
 */
describe.skipIf(!existsSync(CHROME))('time-travel bar (real headless Chromium, mock provider)', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startServer({ port: 0, mock: true });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    page = await browser.newPage({ viewport: { width: 1320, height: 1150 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await handle?.close();
  });

  it('brush → seek back → brush again sprouts a second branch; the old branch stays intact', async () => {
    await page.goto(handle.url);
    await page.waitForSelector('#dashboard svg.scatter');
    await page.waitForSelector('[data-timecard]'); // the time-travel card mounted

    // two linear brushes → two commits on the active timeline
    await brush(page, 0.18, 0.5);
    await page.waitForFunction(() => document.querySelectorAll('.timeline [data-commit]').length >= 1);
    await brush(page, 0.55, 0.85);
    await page.waitForFunction(() => document.querySelectorAll('.timeline [data-commit]').length >= 2);
    // exactly ONE branch so far (linear)
    await page.waitForFunction(() => (document.querySelector('.bm-count')?.textContent ?? '').includes('1 branch'));
    expect(await page.locator('svg.branchmap .bm-node').count()).toBe(2);

    // seek BACK to the first commit by clicking its timeline dot → the viewing-past banner shows
    const firstDot = page.locator('.timeline [data-commit]').first();
    const firstId = await firstDot.getAttribute('data-commit');
    await firstDot.click();
    await page.waitForSelector('.past-banner:not([hidden])', { timeout: 8000 });
    expect(await page.locator('.past-banner').isVisible()).toBe(true);
    // the cursor marker is on the first commit in both timeline + branch map
    await page.waitForFunction((id) => document.querySelector(`.timeline [data-commit="${id}"]`)?.classList.contains('cursor') === true, firstId);

    // act from the PAST → brush again → a SIBLING branch sprouts (two lineages)
    await brush(page, 0.6, 0.92);
    await page.waitForFunction(() => (document.querySelector('.bm-count')?.textContent ?? '').includes('2 branch'), undefined, { timeout: 8000 });
    expect(await page.locator('svg.branchmap .bm-node').count()).toBe(3); // 1 root + 2 tips
    // acting made the new lineage active → the past banner clears
    await page.waitForSelector('.past-banner', { state: 'hidden', timeout: 8000 });

    // old branch intact: the abandoned tip is still a record whose parent is the fork point
    const oldTipIntact = await page.evaluate(async (id) => {
      const st = (await (await fetch('/api/state')).json()) as { records: { id: string; parent: string | null }[]; branches: unknown[] };
      const siblings = st.records.filter((r) => r.parent === id);
      return siblings.length === 2 && st.branches.length === 2; // both children of the fork point survive
    }, firstId);
    expect(oldTipIntact).toBe(true);

    await page.screenshot({ path: path.join(SHOTS, 'time-travel-fork.png'), fullPage: true });
  }, 60_000);

  it('the global FDR ledger survives travel; the two-truths honesty line is verbatim', async () => {
    // widen the selection so the correlation has ample rows (non-degenerate), then
    // declare a correlation test through the human dispatch path
    await brush(page, 0.05, 0.95);
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verb: 'analyze', analysisId: 'correlation', intent: 'declare correlation' }),
      });
    });
    await page.waitForFunction(() => (document.querySelector('table.ledger tbody tr') ? true : false), undefined, { timeout: 8000 });
    const testsBefore = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsBefore).toBeGreaterThanOrEqual(1);

    // travel back to the first commit — the GLOBAL test count must NOT rewind
    await page.locator('.timeline [data-commit]').first().click();
    await page.waitForSelector('.past-banner:not([hidden])', { timeout: 8000 });
    const testsAfter = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsAfter).toBe(testsBefore); // scrubbing back refunds no test / no alpha

    // the verbatim honesty line is rendered
    expect((await page.locator('.tt-honest').textContent()) ?? '').toContain('alpha spent on abandoned branches is never refunded');
    // the two truths are distinct at a past cursor: cursor-local 0 vs global ≥ 1
    const cursorLocal = (await page.locator('.two-truths .tt-line').first().textContent()) ?? '';
    expect(cursorLocal).toContain('at cursor');

    await page.screenshot({ path: path.join(SHOTS, 'time-travel-two-truths.png'), fullPage: true });
  }, 60_000);

  it('the time-travel page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
