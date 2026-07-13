// @vitest-environment node
/**
 * Playwright smoke over the GALLERY — the visual acceptance surface (real
 * headless Chromium, the repo's pinned chrome-headless-shell 1208; the whole
 * scripted session runs in-browser, no server API). The gallery now mounts the
 * FLAGSHIP cockpit. It proves, end to end:
 *   - every layer renders (fill-height charts, compact time bar, live-badged
 *     report chips, status readout) against the scripted real session;
 *   - ZERO page/shell scroll at a desktop viewport — the cockpit locks to the
 *     viewport and the charts scale to their measured container (viewBox ==
 *     CSS box, crisp SVG), instead of the old dashboard-owns-overflow rule;
 *   - clicking an axis label opens the EncodingPicker (now on VizModal); an
 *     incompatible column is disabled-with-reason; picking a compatible one
 *     lands a REAL reencode commit and the scatter re-renders on the new field;
 *   - a report chip opens a LARGE frosted-glass modal hosting the panel, with
 *     scrolling allowed only INSIDE the modal body;
 *   - ⚑ opens the checkpoint naming modal; Enter lands a REAL checkpoint;
 *   - PRESENT mode is checkpoint-only traversal and dims/blocks the charts;
 *   - at a MOBILE viewport the charts become a scroll-snap carousel with dot
 *     indicators — still zero page scroll;
 *   - zero console errors throughout.
 * Screenshots refresh ONLY under UPDATE_SCREENSHOTS=1 (see below).
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

/** Zero page/shell scroll — the cockpit invariant, asserted at any viewport. */
async function expectNoPageOrShellScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const shell = document.querySelector('[data-vzf="cockpit"]') as HTMLElement;
    return {
      pageScrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      pageScrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      shellScrollH: shell.scrollHeight,
      shellClientH: shell.clientHeight,
      shellScrollW: shell.scrollWidth,
      shellClientW: shell.clientWidth,
    };
  });
  expect(m.pageScrollW, 'no horizontal page scroll').toBeLessThanOrEqual(m.innerW);
  expect(m.pageScrollH, 'no vertical page scroll').toBeLessThanOrEqual(m.innerH);
  expect(m.shellScrollH, 'the cockpit shell must not scroll vertically').toBeLessThanOrEqual(m.shellClientH);
  expect(m.shellScrollW, 'the cockpit shell must not scroll horizontally').toBeLessThanOrEqual(m.shellClientW);
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
    // a CONSTRAINED desktop viewport on purpose — the no-scroll assertions depend on it
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

  it('every layer renders against the scripted session (charts, compact bar, badged chips)', async () => {
    // fill-height charts
    expect(await page.locator('svg.vzf-scatter circle.vzf-dot').count()).toBe(60);
    expect(await page.locator('svg.vzf-bar rect.vzf-barrect').count()).toBe(5);
    // the compact time bar rides the top strip
    await page.waitForSelector('[data-vzf="cockpit-top"] [data-vzf="time-travel-bar"][data-mode="explore"]');
    expect(await page.locator('.vzf-timebar.vzf-compact').count()).toBe(1);
    // status strip: the readout + one chip per report, badges live while closed
    expect((await page.locator('[data-vzf="cockpit-status"] .vzf-cockpit-readout').textContent()) ?? '').toContain('rows selected');
    expect(await page.locator('.vzf-report-chip').count()).toBe(5);
    expect(Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent())).toBeGreaterThanOrEqual(4);
    expect((await page.locator('[data-report="branches"] .vzf-report-badge').textContent()) ?? '').toBe('2'); // the script forked
    expect(Number(await page.locator('[data-report="gaps"] .vzf-report-badge').textContent())).toBeGreaterThanOrEqual(1); // the typed reencode gap
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-dashboard.png'), fullPage: false });
  }, 30_000);

  it('single screen: zero page/shell scroll; the charts scale to their measured container', async () => {
    await expectNoPageOrShellScroll(page);
    // the scatter fills its cell: rendered box ≈ measured frame, viewBox == CSS box (crisp 1:1)
    const chart = await page.evaluate(() => {
      const frame = document.querySelector('[data-chart="scatter"] [data-vzf="chart-frame"]') as HTMLElement;
      const svg = frame.querySelector('svg.vzf-scatter') as SVGSVGElement;
      const fr = frame.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      return { frameW: fr.width, frameH: fr.height, svgW: sr.width, svgH: sr.height, viewBox: svg.getAttribute('viewBox') };
    });
    expect(chart.frameH, 'the chart band must be tall (fills remaining height), not the old fixed 340px').toBeGreaterThan(340);
    expect(Math.abs(chart.svgH - chart.frameH)).toBeLessThanOrEqual(2);
    expect(Math.abs(chart.svgW - chart.frameW)).toBeLessThanOrEqual(2);
    expect(chart.viewBox).toBe(`0 0 ${Math.floor(chart.frameW)} ${Math.floor(chart.frameH)}`);
  }, 30_000);

  it('an axis click opens the encoding picker; picking a column lands a REAL reencode', async () => {
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    // the y-axis label is the affordance
    await page.locator('svg.vzf-scatter [data-axis-channel="y"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"] [role="dialog"]');
    // honest disabled-with-reason: a string column cannot ride a positional channel
    const catOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="category"]');
    expect(await catOpt.isDisabled()).toBe(true);
    expect((await catOpt.getAttribute('title')) ?? '').toContain('numeric or date');
    await page.waitForTimeout(250); // let the 160ms entrance animation land before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-encoding-picker.png'), fullPage: false });
    // pick price for y → dispatch({verb:'reencode'}) → a new commit lands + scatter re-renders
    await page.locator('[data-vzf-modal="encoding-picker"] [data-field="price"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    // the scatter now encodes y=price — its y-axis label re-rendered
    const yLabel = await page.locator('svg.vzf-scatter [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabel ?? '').toContain('price');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-reencoded.png'), fullPage: false });
  }, 30_000);

  it('a report chip opens a LARGE glass modal hosting the panel; scroll lives INSIDE the body', async () => {
    await page.locator('[data-report="commits"]').click();
    await page.waitForSelector('[data-vzf-modal="report-commits"] [role="dialog"]');
    // the panel component renders unchanged inside the modal
    expect(await page.locator('[data-vzf-modal="report-commits"] [data-vzf="commit-log"] .vzf-chip').count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    // internal scroll is the modal BODY's job; the page still never scrolls
    const modal = await page.evaluate(() => {
      const body = document.querySelector('[data-vzf-modal="report-commits"] .vzf-modal-body') as HTMLElement;
      const backdrop = document.querySelector('[data-vzf-modal="report-commits"]') as HTMLElement;
      return {
        bodyOverflowY: getComputedStyle(body).overflowY,
        backdropFilter: getComputedStyle(backdrop).backdropFilter,
        pageScrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
      };
    });
    expect(modal.bodyOverflowY, 'the modal body owns any overflow').toBe('auto');
    expect(modal.backdropFilter, 'frosted glass = a real backdrop blur').toContain('blur');
    expect(modal.pageScrollH).toBeLessThanOrEqual(modal.innerH);
    await page.waitForTimeout(250); // let the 160ms entrance animation land before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-report-modal.png'), fullPage: false });
    // Esc closes and the ledger chip hosts its own report
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });
    await page.locator('[data-report="ledger"]').click();
    await page.waitForSelector('[data-vzf-modal="report-ledger"] table.vzf-ledger tbody tr');
    expect((await page.locator('[data-vzf-modal="report-ledger"] .vzf-tt-honest').textContent()) ?? '').toBe(
      'alpha spent on abandoned branches is never refunded',
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-ledger"]', { state: 'detached' });
  }, 30_000);

  it('⚑ opens the checkpoint naming modal; Enter lands a REAL checkpoint at the cursor', async () => {
    const flagsBefore = await page.locator('[data-vzf="timeline"] .vzf-tl-flag', { hasText: '⚑' }).count();
    await page.locator('[data-vzf="checkpoint-open"]').click();
    await page.waitForSelector('[data-vzf-modal="checkpoint"] [role="dialog"]');
    // the field is autofocused and the prompt names the commit it will mark
    expect(await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-name').evaluate((el) => el === document.activeElement)).toBe(true);
    expect((await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-target').textContent()) ?? '').toContain('marks commit #');
    await page.waitForTimeout(250); // let the 160ms entrance animation land before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-checkpoint-modal.png'), fullPage: false });
    await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-name').fill('after reencode');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-vzf-modal="checkpoint"]', { state: 'detached' });
    // a new ⚑ flies on the timeline — the checkpoint went through the real adapter action
    await page.waitForFunction(
      (n) =>
        Array.from(document.querySelectorAll('[data-vzf="timeline"] .vzf-tl-flag')).filter((el) => el.textContent === '⚑').length > n,
      flagsBefore,
      { timeout: 8000 },
    );
  }, 30_000);

  it('present mode = checkpoint-ONLY traversal, read-only shell', async () => {
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Present")').click();
    await page.waitForSelector('[data-vzf="present"]');
    // the full commit timeline is GONE; only the named beats remain
    expect(await page.locator('[data-vzf="timeline"]').count()).toBe(0);
    expect(await page.locator('[data-beat-dot]').count()).toBe(3); // 2 scripted checkpoints + the one named above
    // the current story-beat title shows
    expect(((await page.locator('.vzf-beat-title').textContent()) ?? '').length).toBeGreaterThan(0);
    // the shell dims + blocks the acting charts
    await page.waitForSelector('[data-vzf="cockpit"][data-readonly="true"]');
    expect(await page.locator('.vzf-readonly-note').count()).toBe(1);
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('[data-vzf="cockpit-charts"]')!).pointerEvents),
    ).toBe('none');
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
    // still a single screen in present mode
    await expectNoPageOrShellScroll(page);
    // back to explore — acting returns
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Explore")').click();
    await page.waitForSelector('[data-vzf="cockpit"][data-readonly="false"]');
  }, 30_000);

  it('dark theme renders (prefers-color-scheme) — raised-scrim glass included', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-dark.png'), fullPage: false });
    await page.emulateMedia({ colorScheme: 'light' });
  }, 30_000);

  it('mobile viewport: a scroll-snap chart carousel with dots — still zero page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.waitForTimeout(250); // let the media query + ResizeObserver settle
    await expectNoPageOrShellScroll(page);
    const strip = await page.evaluate(() => {
      const el = document.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
      const cell = el.querySelector('.vzf-cockpit-cell') as HTMLElement;
      const dots = document.querySelector('[data-vzf="cockpit-dots"]') as HTMLElement;
      return {
        snapType: getComputedStyle(el).scrollSnapType,
        cellW: cell.getBoundingClientRect().width,
        stripW: el.clientWidth,
        dotsDisplay: getComputedStyle(dots).display,
        dotCount: dots.querySelectorAll('.vzf-cockpit-dot').length,
      };
    });
    expect(strip.snapType, 'the charts band is a snap carousel on mobile').toContain('x');
    expect(strip.dotsDisplay, 'dot indicators show on mobile').not.toBe('none');
    expect(strip.dotCount).toBe(2);
    expect(Math.abs(strip.cellW - strip.stripW), 'each chart is one full-width page').toBeLessThanOrEqual(2);
    // tapping the second dot swipes to the bar chart page (one full width + gap) and activates the dot
    await page.locator('[data-vzf="cockpit-dots"] .vzf-cockpit-dot').nth(1).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
        const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
        return el.scrollLeft >= el.clientWidth + gap - 2; // the SETTLED snap position, not mid-flight
      },
      undefined,
      { timeout: 8000 },
    );
    await page.waitForSelector('[data-vzf="cockpit-dots"] .vzf-cockpit-dot.vzf-active:nth-child(2)');
    await page.waitForTimeout(150); // let the smooth scroll fully settle before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-mobile.png'), fullPage: false });
    await page.setViewportSize({ width: 1180, height: 640 });
  }, 30_000);

  it('the gallery ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
