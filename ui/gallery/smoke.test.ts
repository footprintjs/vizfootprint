// @vitest-environment node
/**
 * Playwright smoke over the GALLERY — the visual acceptance surface (real
 * headless Chromium, the repo's pinned chrome-headless-shell 1208; the whole
 * scripted session runs in-browser, no server API). It proves, end to end:
 *   - every layer renders (charts, time bar, branch map, commit log, ledger,
 *     gaps, readiness) against the scripted real InteractionSession;
 *   - clicking an axis label opens the EncodingPicker; an incompatible column
 *     is disabled-with-reason; picking a compatible one lands a REAL reencode
 *     commit and the scatter re-renders on the new field;
 *   - PRESENT mode hides non-checkpoint commits (beat dots == checkpoints,
 *     beat title large) and the shell dims/blocks acting (data-readonly);
 *   - the dashboard scrolls on HEIGHT in a constrained viewport
 *     (scrollHeight > clientHeight) and the page body NEVER scrolls sideways;
 *   - zero console errors throughout.
 * Screenshots each surface into gallery/screenshots/.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startGallery } from './serve.mjs';

const CHROME =
  '/Users/sanjay/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'screenshots');

// Screenshot bytes are nondeterministic (antialiasing/timing), so a plain
// `npx vitest run` must NOT rewrite the committed PNGs — that leaves the git
// tree dirty on every run. Refresh them deliberately with:
//   UPDATE_SCREENSHOTS=1 npx vitest run ui/gallery/smoke.test.ts
async function maybeScreenshot(page: Page, options: Parameters<Page['screenshot']>[0]): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS) await page.screenshot(options);
}

describe.skipIf(!existsSync(CHROME))('vizfootprint-ui gallery smoke (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startGallery>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startGallery({ port: 0 });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    // a CONSTRAINED viewport on purpose — the scroll assertions depend on it
    page = await browser.newPage({ viewport: { width: 1180, height: 640 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(handle.url);
    await page.waitForSelector('svg.vzf-scatter');
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await handle?.close();
  });

  it('every layer renders against the scripted session', async () => {
    // charts
    expect(await page.locator('svg.vzf-scatter circle.vzf-dot').count()).toBe(60);
    expect(await page.locator('svg.vzf-bar rect.vzf-barrect').count()).toBe(5);
    // time bar (explore) + branch map: the script forked → 2 branches
    await page.waitForSelector('[data-vzf="time-travel-bar"][data-mode="explore"]');
    expect((await page.locator('[data-vzf="time-travel-bar"] .vzf-muted').textContent()) ?? '').toContain('2 branches');
    expect(await page.locator('[data-vzf="branch-map"] .vzf-bm-node').count()).toBeGreaterThanOrEqual(4);
    // commit log: user + agent commits in one history; the abandoned lineage dims
    expect(await page.locator('[data-vzf="commit-log"] .vzf-chip').count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator('.vzf-chip[data-actor="user"]').count()).toBeGreaterThanOrEqual(2);
    expect(await page.locator('.vzf-chip[data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('.vzf-chip.vzf-offbranch').count()).toBeGreaterThanOrEqual(2);
    // ledger: ONE declared test row + the two truths + the verbatim honesty line
    expect(await page.locator('[data-vzf="fdr-ledger"] table.vzf-ledger tbody tr').count()).toBe(1);
    expect((await page.locator('.vzf-tt-honest').textContent()) ?? '').toBe('alpha spent on abandoned branches is never refunded');
    // gaps: the invalid-channel reencode filed a typed gap
    expect(await page.locator('[data-vzf="gaps-panel"] .vzf-gap-row').count()).toBeGreaterThanOrEqual(1);
    expect((await page.locator('[data-vzf="gaps-panel"]').textContent()) ?? '').toContain('reencode');
    // readiness: correlation runnable, regression honestly blocked (missing column)
    expect((await page.locator('[data-analysis="regression"] .vzf-blocked').textContent()) ?? '').toContain('needs-column');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-dashboard.png'), fullPage: false });
  }, 30_000);

  it('the dashboard scrolls on height; the page body never scrolls sideways', async () => {
    const scroll = await page.evaluate(() => {
      const dash = document.querySelector('[data-vzf="dashboard"]') as HTMLElement;
      return {
        scrollHeight: dash.scrollHeight,
        clientHeight: dash.clientHeight,
        bodyScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        bodyScrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    });
    expect(scroll.scrollHeight, 'dashboard must own vertical overflow').toBeGreaterThan(scroll.clientHeight);
    expect(scroll.bodyScrollWidth, 'no horizontal page scroll').toBeLessThanOrEqual(scroll.innerWidth);
    expect(scroll.bodyScrollHeight, 'the PAGE body must not be the vertical scroller').toBeLessThanOrEqual(scroll.innerHeight);
    // and it actually scrolls
    const moved = await page.evaluate(() => {
      const dash = document.querySelector('[data-vzf="dashboard"]') as HTMLElement;
      dash.scrollTop = 400;
      return dash.scrollTop;
    });
    expect(moved).toBeGreaterThan(0);
    await page.evaluate(() => {
      (document.querySelector('[data-vzf="dashboard"]') as HTMLElement).scrollTop = 0;
    });
  }, 30_000);

  it('an axis click opens the encoding picker; picking a column lands a REAL reencode', async () => {
    const chipsBefore = await page.locator('[data-vzf="commit-log"] .vzf-chip').count();
    // the y-axis label is the affordance
    await page.locator('svg.vzf-scatter [data-axis-channel="y"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"] [role="dialog"]');
    // honest disabled-with-reason: a string column cannot ride a positional channel
    const catOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="category"]');
    expect(await catOpt.isDisabled()).toBe(true);
    expect((await catOpt.getAttribute('title')) ?? '').toContain('numeric or date');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-encoding-picker.png'), fullPage: false });
    // pick price for y → dispatch({verb:'reencode'}) → a new commit lands + scatter re-renders
    await page.locator('[data-vzf-modal="encoding-picker"] [data-field="price"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-vzf="commit-log"] .vzf-chip').length > n,
      chipsBefore,
      { timeout: 8000 },
    );
    // the scatter now encodes y=price — its y-axis label re-rendered
    const yLabel = await page.locator('svg.vzf-scatter [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabel ?? '').toContain('price');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-reencoded.png'), fullPage: false });
  }, 30_000);

  it('present mode = checkpoint-ONLY traversal, read-only shell', async () => {
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Present")').click();
    await page.waitForSelector('[data-vzf="present"]');
    // the full commit timeline is GONE; only the named beats remain
    expect(await page.locator('[data-vzf="timeline"]').count()).toBe(0);
    expect(await page.locator('[data-beat-dot]').count()).toBe(2); // 2 checkpoints, NOT ~7 commits
    // the current story-beat title shows large
    expect(((await page.locator('.vzf-beat-title').textContent()) ?? '').length).toBeGreaterThan(0);
    // the shell dims + blocks acting surfaces
    await page.waitForSelector('[data-vzf="dashboard"][data-readonly="true"]');
    expect(await page.locator('.vzf-readonly-note').count()).toBe(1);
    // prev/next traverse the beats
    const title0 = await page.locator('.vzf-beat-title').textContent();
    const nextBtn = page.locator('[data-beat="next"]');
    const prevBtn = page.locator('[data-beat="prev"]');
    if (await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForFunction((t) => document.querySelector('.vzf-beat-title')?.textContent !== t, title0, { timeout: 8000 });
    } else {
      await prevBtn.click();
      await page.waitForFunction((t) => document.querySelector('.vzf-beat-title')?.textContent !== t, title0, { timeout: 8000 });
    }
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-present.png'), fullPage: false });
    // back to explore — acting returns
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Explore")').click();
    await page.waitForSelector('[data-vzf="dashboard"][data-readonly="false"]');
  }, 30_000);

  it('dark theme renders (prefers-color-scheme)', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-dark.png'), fullPage: false });
    await page.emulateMedia({ colorScheme: 'light' });
  }, 30_000);

  it('the gallery ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
