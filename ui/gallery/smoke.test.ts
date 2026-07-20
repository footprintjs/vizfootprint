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
 *   - the LINE's time brush lands a REAL date-interval commit (ISO string
 *     bounds through the fixed src/data string-interval path) and crossfilters
 *     the other charts; the MAP's region click lands a REAL point commit,
 *     clicking the selected region again clears it; the line's y axis
 *     re-encodes through its restricted picker (x = date columns only);
 *   - PRIM-1, the primitives-built HISTOGRAM as the 6th cell: HOST-computed
 *     buckets (src/data equalWidthBins/recountBins — the chart never bins), a
 *     bucket-edge-snapped interval brush, click-a-bar → one bucket,
 *     click-again → cleared — three REAL commits, crossfiltering both ways;
 *   - D29, the compound-cell HEATMAP as the 8th cell: one cell click selects
 *     price AND category together and lands exactly ONE commit whose predicate
 *     is the AND of both sides; BOTH constraints crossfilter the other charts;
 *     the commit log tells it in plain words ("price 120 – 165 and category =
 *     Formal"); click-again clears both at once;
 *   - a report chip opens a LARGE frosted-glass modal hosting the panel, with
 *     scrolling allowed only INSIDE the modal body;
 *   - ⚑ opens the checkpoint naming modal; Enter lands a REAL checkpoint;
 *   - PRESENT mode is checkpoint-only traversal and dims/blocks the charts;
 *   - BR-2, the full named-paths loop LIVE: acting from a past cursor forks a
 *     NAMED path (ForkToast + BranchPill update), the PathsModal renames and
 *     switches, the branch map wears named lane labels and a per-commit glass
 *     context menu (undo honestly disabled on an analysis), "Compare with
 *     current" opens a real two-path diff, and "Bring this step over" lands a
 *     replayedFrom commit visible in the CommitLog;
 *   - at a MOBILE viewport the charts become a scroll-snap carousel with dot
 *     indicators — still zero page scroll;
 *   - LY-1, the session-carried arrangements LIVE: the Flow/Grid/Focus
 *     switcher lands recorded presets (equal grid cells; a maximized hero
 *     over live thumbnails whose click swaps focus), drag-to-reorder lands an
 *     order commit that renders back from the fold, the commit log tells each
 *     change in plain words ("layout = focus on bar"), time-travel to the
 *     first commit strips the arrangement and Return-to-now restores it —
 *     zero page/shell scroll in EVERY preset;
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
/** Element-scoped variant (the pill-state shots crop to the cockpit's top band). */
async function maybeElementShot(page: Page, selector: string, path: string): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS) await page.locator(selector).screenshot({ path });
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
    // fill-height charts — all FIVE first-party cells
    expect(await page.locator('svg.vzf-scatter circle.vzf-dot').count()).toBe(60);
    expect(await page.locator('svg.vzf-bar rect.vzf-barrect').count()).toBe(5);
    expect(await page.locator('svg.vzf-line path.vzf-line-path').count()).toBe(5); // one per category series
    expect(await page.locator('svg.vzf-line circle.vzf-line-dot').count()).toBeGreaterThan(0);
    expect(await page.locator('svg.vzf-map path.vzf-region').count()).toBe(5);
    // the histogram cell (built from the public primitives): 8 HOST-computed buckets
    expect(await page.locator('svg.vzf-histogram rect.vzf-histbar').count()).toBe(8);
    await maybeElementShot(page, '[data-chart="histogram"]', path.join(SHOTS, 'gallery-histogram.png'));
    // the heatmap cell (D29): 6 HOST-computed price buckets × 5 category rows
    expect(await page.locator('svg.vzf-heatmap rect.vzf-heatcell').count()).toBe(30);
    await maybeElementShot(page, '[data-chart="heatmap"]', path.join(SHOTS, 'gallery-heatmap.png'));
    // the uninhabited region is HONESTLY empty: neutral fill class + no-rows tooltip
    const isles = page.locator('svg.vzf-map [data-region="Outer Isles"]');
    expect((await isles.getAttribute('class')) ?? '').toContain('vzf-region-empty');
    expect((await isles.locator('title').textContent()) ?? '').toContain('no rows');
    await maybeElementShot(page, '[data-chart="line"]', path.join(SHOTS, 'gallery-line.png'));
    await maybeElementShot(page, '[data-chart="map"]', path.join(SHOTS, 'gallery-map.png'));
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
    // viewBox == CSS box 1:1 — within a pixel: ChartFrame measures offsetWidth
    // (a ROUNDED integer) while the rect here is fractional, so an exact
    // floor-string compare would flake on any non-integer cell width (the
    // FIX-FILL suite pins the same invariant with the same tolerance)
    const [, , vbW, vbH] = (chart.viewBox ?? '0 0 0 0').split(' ').map(Number);
    expect(Math.abs(vbW! - chart.frameW)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(vbH! - chart.frameH)).toBeLessThanOrEqual(1.5);
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

  it('the histogram (the primitives-built 6th cell) brushes buckets, clicks one, and click-again clears — all REAL commits', async () => {
    const commits = async (): Promise<number> =>
      Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const scatterDimBefore = await page.locator('svg.vzf-scatter circle.vzf-dim').count();

    // 1) drag across the upper-price buckets → ONE interval commit, snapped to
    //    the host-computed bucket edges; the OTHER charts crossfilter
    const c0 = await commits();
    const box = (await page.locator('svg.vzf-histogram').boundingBox())!;
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.55, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.92, midY, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      c0,
      { timeout: 8000 },
    );
    // the scatter dims the rows outside the bucket range (crossfilter into it) …
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBeGreaterThan(scatterDimBefore);
    // … and the covered buckets wear the selection outline (derived from the fold)
    await page.waitForSelector('svg.vzf-histogram rect.vzf-histbar.vzf-selected');
    expect(await page.locator('svg.vzf-histogram rect.vzf-histbar.vzf-selected').count()).toBeGreaterThanOrEqual(2);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-histogram-brushed.png'), fullPage: false });

    // 2) click ONE bar → exactly that bucket's interval replaces the range
    const c1 = await commits();
    const bar = (await page.locator('svg.vzf-histogram rect.vzf-hist-hit').nth(2).boundingBox())!;
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      c1,
      { timeout: 8000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll('svg.vzf-histogram rect.vzf-histbar.vzf-selected').length === 1,
      undefined,
      { timeout: 8000 },
    );

    // 3) click the SAME bar again → the CLEARED interval; the filter releases
    const c2 = await commits();
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      c2,
      { timeout: 8000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll('svg.vzf-histogram rect.vzf-histbar.vzf-selected').length === 0,
      undefined,
      { timeout: 8000 },
    );
    // the crossfilter released with it — the scatter's dims return to baseline
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBe(scatterDimBefore);
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('the heatmap (D29): one cell click = ONE compound commit; BOTH constraints crossfilter; click-again clears', async () => {
    const commits = async (): Promise<number> =>
      Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const readout = async (): Promise<number> =>
      Number((((await page.locator('.vzf-cockpit-readout').textContent()) ?? '').match(/^(\d+) of 60/) ?? [])[1]);
    const rowsBefore = await readout();
    const scatterDimBefore = await page.locator('svg.vzf-scatter circle.vzf-dim').count();

    // 1) click a NON-EMPTY cell → exactly ONE commit lands (the D29 ruling),
    //    and its predicate is the AND of both sides — the readout drops to
    //    that cell's rows and the scatter dims the rows either side excluded
    const c0 = await commits();
    const cell = page.locator('svg.vzf-heatmap rect.vzf-heatcell:not(.vzf-heatcell-empty)').first();
    await cell.click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      c0,
      { timeout: 8000 },
    );
    expect(await commits()).toBe(c0 + 1); // ONE commit — never two correlationId-linked ones
    const rowsUnderCell = await readout();
    expect(rowsUnderCell).toBeGreaterThan(0); // the cell was non-empty, so the AND keeps its rows
    expect(rowsUnderCell).toBeLessThan(rowsBefore); // …and BOTH constraints genuinely filter
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBeGreaterThan(scatterDimBefore);
    // the selected cell wears the outline, derived from the fold
    await page.waitForSelector('svg.vzf-heatmap rect.vzf-heatcell.vzf-selected');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-heatmap-crossfiltered.png'), fullPage: false });

    // the commit log tells the compound in plain words ("price 120 – 165 and category = Formal")
    await page.locator('[data-report="commits"]').click();
    await page.waitForSelector('[data-vzf-modal="report-commits"] [data-vzf="commit-log"]');
    const logText = (await page.locator('[data-vzf-modal="report-commits"]').textContent()) ?? '';
    expect(logText).toMatch(/price \d+(\.\d+)? – \d+(\.\d+)? and category = /);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });

    // 2) click the SAME cell again → the CLEARED cell (one more real commit);
    //    BOTH constraints release and the crossfilter returns to baseline
    const c1 = await commits();
    await page.locator('svg.vzf-heatmap rect.vzf-heatcell.vzf-selected').click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      c1,
      { timeout: 8000 },
    );
    expect(await commits()).toBe(c1 + 1);
    await page.waitForFunction(
      () => document.querySelectorAll('svg.vzf-heatmap rect.vzf-heatcell.vzf-selected').length === 0,
      undefined,
      { timeout: 8000 },
    );
    expect(await readout()).toBe(rowsBefore);
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBe(scatterDimBefore);
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('the line time brush lands a REAL date-interval commit and crossfilters the other charts', async () => {
    const readout = async (): Promise<number> =>
      Number((((await page.locator('.vzf-cockpit-readout').textContent()) ?? '').match(/^(\d+) of 60/) ?? [])[1]);
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const rowsBefore = await readout();
    const scatterDimBefore = await page.locator('svg.vzf-scatter circle.vzf-dim').count();

    // drag across the RIGHT third of the line plot (the late, high-price weeks,
    // overlapping the scripted price brush so the intersection stays non-empty;
    // 0.65 not 0.45 — the D29 heatmap made the band one cell denser, so the
    // narrower line plot needs a tighter drag to actually exclude early dates)
    const box = (await page.locator('svg.vzf-line').boundingBox())!;
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.65, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, midY, { steps: 8 });
    await page.mouse.up();

    // one REAL filter commit on the date field
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    // the interval CROSSFILTERS: fewer rows selected, scatter dims dated-out points
    const rowsAfter = await readout();
    expect(rowsAfter).toBeLessThan(rowsBefore);
    expect(rowsAfter).toBeGreaterThan(0); // ISO string bounds actually MATCH (the src/data fix, end to end)
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBeGreaterThan(scatterDimBefore);
  }, 30_000);

  it('a map region click lands a REAL point commit; clicking the selected region again clears it', async () => {
    const readout = async (): Promise<number> =>
      Number((((await page.locator('.vzf-cockpit-readout').textContent()) ?? '').match(/^(\d+) of 60/) ?? [])[1]);
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const rowsBefore = await readout();

    // select Northlands → a point commit + the selection stroke + a narrower selection
    await page.locator('svg.vzf-map [data-region="Northlands"]').click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    await page.waitForSelector('svg.vzf-map [data-region="Northlands"].vzf-selected');
    expect(await page.locator('svg.vzf-map [data-region="Northlands"]').getAttribute('aria-pressed')).toBe('true');
    const rowsSelected = await readout();
    expect(rowsSelected).toBeLessThan(rowsBefore);
    // the fully crossfiltered cockpit: time brush + region selection together
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-crossfiltered.png'), fullPage: false });

    // clicking the SELECTED region again clears the point selection (a real commit, not a UI trick)
    const commitsMid = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('svg.vzf-map [data-region="Northlands"]').click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsMid,
      { timeout: 8000 },
    );
    await page.waitForSelector('svg.vzf-map [data-region="Northlands"]:not(.vzf-selected)');
    expect(await readout()).toBeGreaterThan(rowsSelected); // the region filter released

    // leave Northlands SELECTED for the later story (compare diff shows the map selection)
    await page.locator('svg.vzf-map [data-region="Northlands"]').click();
    await page.waitForSelector('svg.vzf-map [data-region="Northlands"].vzf-selected');
  }, 30_000);

  it("the line's axis pickers are honestly restricted; picking a numeric column re-encodes y", async () => {
    // x: only date-capable columns — a numeric column is disabled WITH the reason
    await page.locator('svg.vzf-line [data-axis-channel="x"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"] [role="dialog"]');
    const priceOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="price"]');
    expect(await priceOpt.isDisabled()).toBe(true);
    expect((await priceOpt.getAttribute('title')) ?? '').toContain('needs a date column');
    const dateOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="date"]');
    expect(await dateOpt.isDisabled()).toBe(false); // vouched for by the chart itself
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });

    // y: numeric only — category refuses with its reason; rating re-encodes for real
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('svg.vzf-line [data-axis-channel="y"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"] [role="dialog"]');
    const catOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="category"]');
    expect(await catOpt.isDisabled()).toBe(true);
    expect((await catOpt.getAttribute('title')) ?? '').toContain('y needs a numeric column');
    await page.locator('[data-vzf-modal="encoding-picker"] [data-field="rating"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    // the line now encodes y=rating — its y-axis label re-rendered from the fold
    const yLabel = await page.locator('svg.vzf-line [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabel ?? '').toContain('rating');
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

  it('BR-2: forking from the past auto-names a path — toast up, pill flips to the new path', async () => {
    // the present-mode walk left the cursor detached in the past → the pill is honest about it
    const pill = page.locator('[data-vzf="cockpit-top"] [data-vzf="branch-pill"]');
    expect(await pill.getAttribute('data-state')).toBe('viewing-past');
    expect(((await pill.textContent()) ?? '')).toContain('viewing past');
    await maybeElementShot(page, '[data-vzf="cockpit-top"]', path.join(SHOTS, 'gallery-pill-past.png'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(120);
    await maybeElementShot(page, '[data-vzf="cockpit-top"]', path.join(SHOTS, 'gallery-pill-past-dark.png'));
    await page.emulateMedia({ colorScheme: 'light' });

    // travel to the very first commit, then ACT → branch-on-act, now NAMED
    await page.locator('[data-vzf="timeline"] [data-commit]').first().click();
    await page.locator('svg.vzf-bar rect.vzf-barrect').nth(3).click(); // 'Work' ≠ the agent's Formal
    // the toast announces the fork with the auto-slugged name; the pill re-attaches
    await page.waitForSelector('[data-vzf="fork-toast"]');
    const toastText = (await page.locator('[data-vzf="fork-toast"]').textContent()) ?? '';
    expect(toastText).toContain('Forked a new path');
    expect(toastText).toContain('bar-click'); // slug of the emit intent 'bar click'
    expect(toastText).toContain('safe in Paths');
    await page.waitForTimeout(300); // let the toast's rise + the pill's colour transition land before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-fork-toast.png'), fullPage: false });
    await page.waitForFunction(() => document.querySelector('[data-vzf="branch-pill"]')?.getAttribute('data-state') === 'on-path');
    expect((await pill.textContent()) ?? '').toContain('bar-click');
    await page.locator('[data-vzf="fork-toast-dismiss"]').click();
    await page.waitForSelector('[data-vzf="fork-toast"]', { state: 'detached' });
    await expectNoPageOrShellScroll(page); // the toast never takes layout space
  }, 30_000);

  it('BR-2: the PathsModal renames the fork inline and switches back to main; the pill follows', async () => {
    await page.locator('[data-vzf="branch-pill"]').click();
    await page.waitForSelector('[data-vzf-modal="paths"] [role="dialog"]');
    expect(await page.locator('[data-vzf-modal="paths"] [data-path]').count()).toBeGreaterThanOrEqual(3); // main + the scripted fork + bar-click
    // the current path sorts first and wears the marker
    const firstRow = page.locator('[data-vzf-modal="paths"] [data-path]').first();
    expect(await firstRow.getAttribute('data-path')).toBe('bar-click');
    expect((await firstRow.locator('.vzf-path-current').textContent()) ?? '').toContain('current');
    // inline rename: ✎ → type → Enter
    await firstRow.locator('[data-vzf="path-rename"]').click();
    await page.locator('[data-vzf-modal="paths"] .vzf-path-rename-input').fill('my-fork');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-vzf-modal="paths"] [data-path="my-fork"]');
    await page.waitForTimeout(250); // let the entrance animation land before shooting
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-paths-modal.png'), fullPage: false });
    // switching completes the intent: the modal closes, the pill flips to main
    await page.locator('[data-vzf-modal="paths"] [data-path="main"] [data-vzf="path-switch"]').click();
    await page.waitForSelector('[data-vzf-modal="paths"]', { state: 'detached' });
    await page.waitForFunction(() => (document.querySelector('[data-vzf="branch-pill"]')?.textContent ?? '').includes('main'));
    expect(await page.locator('[data-vzf="branch-pill"]').getAttribute('data-state')).toBe('on-path');
    await maybeElementShot(page, '[data-vzf="cockpit-top"]', path.join(SHOTS, 'gallery-pill-onpath.png'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(120);
    await maybeElementShot(page, '[data-vzf="cockpit-top"]', path.join(SHOTS, 'gallery-pill-onpath-dark.png'));
    await page.emulateMedia({ colorScheme: 'light' });
  }, 30_000);

  it('BR-2: the branch map wears named lanes; the commit menu is honest; Compare shows a real two-path diff', async () => {
    await page.locator('[data-report="branches"]').click();
    await page.waitForSelector('[data-vzf-modal="report-branches"] [data-vzf="branch-map"]');
    // named lane labels, the current path's in violet (vzf-active)
    expect(await page.locator('[data-vzf-modal="report-branches"] .vzf-bm-lane-label').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('[data-vzf-modal="report-branches"] .vzf-bm-lane-label.vzf-active').textContent()).toContain('main');

    // honesty first: the declared-test commit's Undo is disabled WITH the reason
    await page.locator('[data-vzf-modal="report-branches"] g.vzf-bm-node').filter({ hasText: 'test' }).first().click();
    await page.waitForSelector('[data-vzf="ctx-menu"]');
    const undoItem = page.locator('[data-vzf="ctx-menu"] [data-ctx="undo"]');
    expect(await undoItem.isDisabled()).toBe(true);
    expect((await undoItem.getAttribute('title')) ?? '').toContain('never refunds alpha');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf="ctx-menu"]', { state: 'detached' });

    // the my-fork tip (the newest commit) → Compare with current
    await page.locator('[data-vzf-modal="report-branches"] g.vzf-bm-node').last().click();
    await page.waitForSelector('[data-vzf="ctx-menu"]');
    await page.locator('[data-vzf="ctx-menu"] [data-ctx="compare"]').click();
    await page.waitForSelector('[data-vzf-modal="compare"] [data-vzf="compare-ancestor"]');
    // a REAL diff: common ancestor, per-side row counts, plain-language chips
    expect((await page.locator('[data-vzf="compare-ancestor"]').textContent()) ?? '').toContain('#');
    expect((await page.locator('[data-vzf-modal="compare"] [data-side="a"] .vzf-compare-rows').textContent()) ?? '').toContain('rows selected');
    // the two brushes/selections diverged → a ≠ chip on both sides
    expect(await page.locator('[data-vzf-modal="compare"] .vzf-diff-changed').count()).toBeGreaterThanOrEqual(2);
    // main ran the correlation test the fork never did → an only-B analysis chip
    expect((await page.locator('[data-vzf-modal="compare"] [data-side="b"]').textContent()) ?? '').toContain('correlation');
    await page.waitForTimeout(250);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-compare-modal.png'), fullPage: false });
    // Esc peels only the top modal (compare); the report closes via its own ✕
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="compare"]', { state: 'detached' });
    expect(await page.locator('[data-vzf-modal="report-branches"]').count()).toBe(1);
    await page.locator('[data-vzf-modal="report-branches"] [aria-label="Close"]').click();
    await page.waitForSelector('[data-vzf-modal="report-branches"]', { state: 'detached' });
  }, 30_000);

  it('BR-2: "Bring this step over" lands a replayedFrom commit (with its honest conflict tag) in the CommitLog', async () => {
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('[data-report="branches"]').click();
    await page.waitForSelector('[data-vzf-modal="report-branches"] [data-vzf="branch-map"]');
    // bring the my-fork tip (bar=Work) over to main — the agent's Formal touched the same key → a conflict note
    await page.locator('[data-vzf-modal="report-branches"] g.vzf-bm-node').last().click();
    await page.waitForSelector('[data-vzf="ctx-menu"]');
    await page.locator('[data-vzf="ctx-menu"] [data-ctx="bring-over"]').click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    await page.locator('[data-vzf-modal="report-branches"] [aria-label="Close"]').click();
    await page.waitForSelector('[data-vzf-modal="report-branches"]', { state: 'detached' });
    // the landed commit tells its own story in the log
    await page.locator('[data-report="commits"]').click();
    await page.waitForSelector('[data-vzf-modal="report-commits"] [data-vzf="commit-log"]');
    expect((await page.locator('[data-vzf-modal="report-commits"] .vzf-replay').last().textContent()) ?? '').toContain('brought over from #');
    expect((await page.locator('[data-vzf-modal="report-commits"] .vzf-conflict').last().textContent()) ?? '').toContain('overridden');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('dark theme renders (prefers-color-scheme) — raised-scrim glass included', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-dark.png'), fullPage: false });
    // the new charts in the dark palette (the map's ramp flips its anchor: high = brightest)
    await maybeElementShot(page, '[data-chart="line"]', path.join(SHOTS, 'gallery-line-dark.png'));
    await maybeElementShot(page, '[data-chart="map"]', path.join(SHOTS, 'gallery-map-dark.png'));
    // the heatmap rides the same flipped ramp tokens (D29)
    await maybeElementShot(page, '[data-chart="heatmap"]', path.join(SHOTS, 'gallery-heatmap-dark.png'));
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
    // scatter · line · bar · map · histogram · heatmap (D29) · vl (the bridge
    // cell) · the AGENT-AUTHORED chart (RP-3) — all eight ride the carousel
    expect(strip.dotCount).toBe(8);
    expect(Math.abs(strip.cellW - strip.stripW), 'each chart is one full-width page').toBeLessThanOrEqual(2);
    // both NEW charts are carousel cells with live content
    expect(await page.locator('[data-chart="line"] svg.vzf-line').count()).toBe(1);
    expect(await page.locator('[data-chart="map"] svg.vzf-map path.vzf-region').count()).toBe(5);
    // the vega-lite bridge cell rides the carousel too — a real vega svg, live
    expect(await page.locator('[data-chart="vl"] svg').count()).toBe(1);
    // tapping the second dot swipes to the LINE page (one full width + gap) and activates the dot
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

  it('the vega-lite BRIDGE cell brushes rating, lands a REAL commit, and crossfilters both ways', async () => {
    // vega renders its own SVG group tree (no data- hooks like the first-party
    // charts); the plot's DRAG-CAPTURE surface is vega-lite's "root frame"
    // background group — NOT the interval-selection's own `_brush`/`_brush_bg`
    // indicator marks, which stay a zero-size rect until a selection exists
    // and would make a coordinate-based drag land on nothing.
    const vlPlotBox = async (): Promise<{ x: number; y: number; width: number; height: number }> =>
      page.evaluate(() => {
        const cell = document.querySelector('[data-chart="vl"]') as HTMLElement;
        const svg = cell.querySelector('svg') as SVGSVGElement;
        const root = Array.from(svg.querySelectorAll('g')).find(
          (g) => g.getAttribute('class') === 'mark-group role-frame root',
        );
        const el = (root?.querySelector('rect') ?? root?.querySelector('path') ?? root) as Element;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const readout = async (): Promise<number> =>
      Number((((await page.locator('.vzf-cockpit-readout').textContent()) ?? '').match(/^(\d+) of 60/) ?? [])[1]);

    // the bridge cell renders a real vega svg with one mark per row
    expect(await page.locator('[data-chart="vl"] svg').count()).toBe(1);
    await maybeElementShot(page, '[data-chart="vl"]', path.join(SHOTS, 'gallery-vega-lite.png'));

    // ── brush THIS chart → a REAL interval commit, with its origin in the
    //    cause (the same rail every first-party chart's onEmit uses) ──
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const rowsBefore = await readout();
    const box = await vlPlotBox();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    // the interval CROSSFILTERS: fewer rows selected, the scatter dims points outside the rating brush
    const rowsAfter = await readout();
    expect(rowsAfter).toBeLessThan(rowsBefore);
    expect(rowsAfter).toBeGreaterThan(0);
    expect(await page.locator('svg.vzf-scatter circle.vzf-dim').count()).toBeGreaterThan(0);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-vega-lite-crossfiltered.png'), fullPage: false });

    // ── the OTHER direction: brushing the SCATTER dims the vega-lite marks
    //    via the bridge-injected __vzfKeep opacity encode ──
    const commitsBefore2 = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const scatterBox = (await page.locator('svg.vzf-scatter').boundingBox())!;
    await page.mouse.move(scatterBox.x + scatterBox.width * 0.15, scatterBox.y + scatterBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(scatterBox.x + scatterBox.width * 0.55, scatterBox.y + scatterBox.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore2,
      { timeout: 8000 },
    );
    const vlDim = await page.evaluate(() => {
      const cell = document.querySelector('[data-chart="vl"]') as HTMLElement;
      const marksGroup = Array.from(cell.querySelectorAll('g')).find(
        (g) => g.getAttribute('class') === 'mark-symbol role-mark marks',
      );
      const marks = Array.from(marksGroup?.querySelectorAll('path') ?? []);
      return { total: marks.length, dimmed: marks.filter((m) => m.getAttribute('opacity') === '0.25').length };
    });
    expect(vlDim.total).toBe(60); // one mark per row — the bridge never filters its own rows
    expect(vlDim.dimmed).toBeGreaterThan(0); // the OTHER view's clause dims rows outside it (self-exclusion intact)

    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('RP-3: the AGENT-AUTHORED chart renders via the RP-2 bridge, crossfilters, and a rejected proposal shows in Gaps', async () => {
    await page.setViewportSize({ width: 1180, height: 640 });
    await page.waitForTimeout(150);
    // the ledgered agent-authored chart is a real cockpit cell rendered by the
    // SAME vega-lite bridge as the 'vl' cell — a live vega svg with one mark per row.
    const cell = page.locator('[data-chart="chart:agent-price-rating"]');
    await cell.waitFor();
    expect(await cell.locator('svg').count()).toBe(1);
    await maybeElementShot(page, '[data-chart="chart:agent-price-rating"]', path.join(SHOTS, 'gallery-agent-chart.png'));

    // it RECEIVES the crossfilter: brushing the scatter dims the agent chart's
    // marks via the bridge-injected __vzfKeep opacity encode (self-exclusion intact).
    const scatterBox = (await page.locator('svg.vzf-scatter').boundingBox())!;
    await page.mouse.move(scatterBox.x + scatterBox.width * 0.15, scatterBox.y + scatterBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(scatterBox.x + scatterBox.width * 0.5, scatterBox.y + scatterBox.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      () => {
        const c = document.querySelector('[data-chart="chart:agent-price-rating"]') as HTMLElement | null;
        if (!c) return false;
        const marks = Array.from(c.querySelectorAll('g.mark-symbol.role-mark.marks path'));
        return marks.length > 0 && marks.some((m) => m.getAttribute('opacity') === '0.25');
      },
      undefined,
      { timeout: 8000 },
    );

    // the REJECTED proposal (a transform-carrying spec) rendered NOTHING and
    // shows its typed reason in the Gaps report.
    expect(await page.locator('[data-chart="chart:agent-bad-agg"]').count()).toBe(0);
    await page.locator('[data-report="gaps"]').click();
    await page.waitForSelector('[data-vzf-modal="report-gaps"] [role="dialog"]');
    const gapsText = (await page.locator('[data-vzf-modal="report-gaps"]').textContent()) ?? '';
    expect(gapsText).toContain('chart-transforms-not-owned');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-gaps"]', { state: 'detached' });
  }, 30_000);

  it('LY-1: the switcher lands recorded presets — Grid arranges equal cells, zero scroll', async () => {
    await page.setViewportSize({ width: 1180, height: 640 });
    await page.waitForTimeout(150);
    // the switcher rides the top strip: three plain-named options, Flow active
    const options = page.locator('[data-vzf="layout-switch"] [role="radio"]');
    expect(await options.allTextContents()).toEqual(['Flow', 'Grid', 'Focus']);
    expect(await page.locator('[data-vzf="layout-switch"] [aria-checked="true"]').textContent()).toBe('Flow');
    expect(await page.locator('[data-vzf="cockpit-charts"]').getAttribute('data-preset')).toBe('flow');

    // Grid → a REAL commit lands and every cell gets the same width
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('[data-preset-option="grid"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="grid"]');
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    await page.waitForTimeout(400); // let the FLIP morph land — getBoundingClientRect includes live transforms
    const widths = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] .vzf-cockpit-cell')).map((el) => el.getBoundingClientRect().width),
    );
    expect(widths.length).toBeGreaterThanOrEqual(6); // 4 first-party + vl + the agent chart
    for (const w of widths) expect(Math.abs(w - widths[0]!)).toBeLessThanOrEqual(2); // equal cells
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-layout-grid.png'), fullPage: false });
  }, 30_000);

  it('LY-1: Focus maximizes one chart over a live thumbnail rail; a thumbnail click swaps the hero', async () => {
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('[data-preset-option="focus"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="focus"]');
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    await page.waitForTimeout(400); // let the FLIP morph land — rects mid-transform would lie
    // one hero (the first cell by default), everyone else a thumb on the rail
    const shape = await page.evaluate(() => {
      const hero = document.querySelector('[data-vzf="cockpit-charts"] [data-focused="true"]') as HTMLElement;
      const thumbs = Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] .vzf-thumb')) as HTMLElement[];
      return {
        heroId: hero.getAttribute('data-chart'),
        heroH: hero.getBoundingClientRect().height,
        thumbHs: thumbs.map((t) => t.getBoundingClientRect().height),
        overlays: thumbs.filter((t) => t.querySelector('[data-vzf="focus-thumb"]')).length,
        liveSvgs: thumbs.filter((t) => t.querySelector('svg')).length,
      };
    });
    expect(shape.heroId).toBe('scatter');
    expect(shape.thumbHs.length).toBeGreaterThanOrEqual(5);
    for (const h of shape.thumbHs) expect(shape.heroH).toBeGreaterThan(h * 3); // genuinely maximized
    expect(shape.overlays).toBe(shape.thumbHs.length); // every thumb swaps on click
    expect(shape.liveSvgs).toBe(shape.thumbHs.length); // thumbs are scaled-down LIVE cells, not stills
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-layout-focus.png'), fullPage: false });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'gallery-layout-focus-dark.png'), fullPage: false });
    await page.emulateMedia({ colorScheme: 'light' });

    // clicking the bar thumbnail swaps focus — a recorded commit, plain words in the log
    const commitsMid = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('[data-chart="bar"] [data-vzf="focus-thumb"]').click();
    await page.waitForSelector('[data-chart="bar"][data-focused="true"]');
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsMid,
      { timeout: 8000 },
    );
    await page.locator('[data-report="commits"]').click();
    await page.waitForSelector('[data-vzf-modal="report-commits"] [data-vzf="commit-log"]');
    const logText = (await page.locator('[data-vzf-modal="report-commits"]').textContent()) ?? '';
    expect(logText).toContain('layout = focus on bar'); // the commit log tells it in plain words
    expect(logText).toContain('layout = grid');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('LY-1: drag-to-reorder persists the order as a recorded commit', async () => {
    // back to Flow so the drag reads on the plain band
    await page.locator('[data-preset-option="flow"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="flow"]');
    await page.waitForTimeout(400); // settle the FLIP morph — cells (and their grips) are mid-transform until it lands
    const orderBefore = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] [data-chart]')).map((el) => el.getAttribute('data-chart')),
    );
    expect(orderBefore[0]).toBe('scatter');

    // drag the scatter's grip onto the line cell (pointer-based, real mouse)
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    const grip = (await page.locator('[data-chart="scatter"] [data-vzf="drag-handle"]').boundingBox())!;
    const lineBox = (await page.locator('[data-chart="line"]').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n,
      commitsBefore,
      { timeout: 8000 },
    );
    const orderAfter = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] [data-chart]')).map((el) => el.getAttribute('data-chart')),
    );
    expect(orderAfter.slice(0, 2)).toEqual(['line', 'scatter']); // the drop landed and rendered back from the fold
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('LY-1: time-travel restores the arrangement — the layout is fold-carried view-state', async () => {
    // we are on flow with a custom order + focus/grid notes behind us
    expect(await page.locator('[data-vzf="cockpit-charts"]').getAttribute('data-preset')).toBe('flow');
    // seek to the very FIRST commit — before any layout note existed
    await page.locator('[data-vzf="timeline"] [data-commit]').first().click();
    await page.waitForSelector('[data-vzf="return-now"]'); // viewing past now
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="flow"]');
    const pastOrder = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] [data-chart]')).map((el) => el.getAttribute('data-chart')),
    );
    expect(pastOrder[0]).toBe('scatter'); // the saved order is gone in the past — consumer order rules
    // return to now WITHOUT acting (no fork): the drag order + flow preset come back
    await page.locator('[data-vzf="return-now"]').click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-vzf="cockpit-charts"] [data-chart]')[0]?.getAttribute('data-chart') === 'line',
      undefined,
      { timeout: 8000 },
    );
    expect(await page.locator('[data-vzf="cockpit-charts"]').getAttribute('data-preset')).toBe('flow');
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('FIX-FILL: after a preset morph every chart still FILLS its cell at a TALL viewport (Flow, Grid, Focus)', async () => {
    // The regression: ChartFrame measured getBoundingClientRect() — during the
    // FLIP morph the inverse transform makes the new layout box read as the OLD
    // one, transforms never re-fire a ResizeObserver, and the stale size froze
    // into the viewBox → charts letterboxed to ~1/3 of the cell. So every
    // assertion here runs AFTER a live preset morph, at a tall viewport.
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.waitForTimeout(200);

    // Threshold, from the fixed geometry: a cell's non-chart chrome is
    // 2×12px padding (--vzf-space-3) + ~17px caption + 4px row gap ≈ 45px.
    // The SHORTEST asserted cell (grid row at 1100px tall) is ≈ 470px → chrome
    // ≈ 10% of the cell, so a healthy chart's svg ≥ 90% of its cell; the broken
    // letterbox drew at ~33–47%. 85% is the honest floor with real margin.
    const FILL = 0.85;
    const measureCells = () =>
      page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[data-vzf="cockpit-charts"] [data-chart]'));
        return cells.map((cell) => {
          const frame = cell.querySelector('[data-vzf="chart-frame"]');
          const svg = frame?.querySelector('svg') ?? null;
          const vb = svg?.getAttribute('viewBox')?.split(' ').map(Number) ?? null;
          return {
            id: cell.getAttribute('data-chart'),
            thumb: cell.classList.contains('vzf-thumb'),
            cellH: cell.getBoundingClientRect().height,
            frameW: frame ? frame.getBoundingClientRect().width : 0,
            frameH: frame ? frame.getBoundingClientRect().height : 0,
            svgH: svg ? svg.getBoundingClientRect().height : 0,
            firstParty: svg?.classList.contains('vzf-chart') ?? false,
            vbW: vb ? vb[2]! : null,
            vbH: vb ? vb[3]! : null,
          };
        });
      });
    const expectFilled = (cells: Awaited<ReturnType<typeof measureCells>>, preset: string): void => {
      for (const c of cells) {
        if (c.svgH === 0) continue; // the table cell hosts no svg
        expect(c.svgH, `${preset}/${c.id}: svg ≥ ${FILL * 100}% of its cell`).toBeGreaterThanOrEqual(c.cellH * FILL);
        if (c.firstParty) {
          // viewBox == CSS box 1:1 — the exact invariant the stale measure broke
          expect(Math.abs(c.vbW! - c.frameW), `${preset}/${c.id}: viewBox width rides the frame`).toBeLessThanOrEqual(1.5);
          expect(Math.abs(c.vbH! - c.frameH), `${preset}/${c.id}: viewBox height rides the frame`).toBeLessThanOrEqual(1.5);
        }
      }
    };

    // Grid — a morph from flow lands equal cells; every chart must re-fill
    await page.locator('[data-preset-option="grid"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="grid"]');
    await page.waitForTimeout(400); // the 260ms FLIP settles
    const grid = await measureCells();
    expect(grid.length).toBeGreaterThanOrEqual(6);
    expectFilled(grid, 'grid');
    await expectNoPageOrShellScroll(page);

    // Focus — hero + live thumbnails, all still viewBox == box after the morph
    await page.locator('[data-preset-option="focus"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="focus"]');
    await page.waitForTimeout(400);
    const focus = await measureCells();
    expectFilled(focus, 'focus');
    expect(focus.filter((c) => c.thumb).length).toBeGreaterThanOrEqual(5); // the rail is live
    await expectNoPageOrShellScroll(page);

    // Flow — the TALL columns where the user hit the letterbox; morph back and re-check
    await page.locator('[data-preset-option="flow"]').click();
    await page.waitForSelector('[data-vzf="cockpit-charts"][data-preset="flow"]');
    await page.waitForTimeout(400);
    const flow = await measureCells();
    expectFilled(flow, 'flow');
    for (const c of flow.filter((x) => x.firstParty)) {
      expect(c.cellH, `flow/${c.id}: the tall cell really is tall`).toBeGreaterThan(900);
    }
    await expectNoPageOrShellScroll(page);
    await page.setViewportSize({ width: 1180, height: 640 });
  }, 45_000);

  it('the gallery ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
