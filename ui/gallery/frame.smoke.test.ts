// @vitest-environment node
/**
 * Playwright smoke over the FRAME page — real headless Chromium, the real
 * scripted session. It proves the five things a stack of layers has to get
 * right, and that no unit test can prove because they are about pixels:
 *
 *   - ONE guide for the stack (the frame's), and no layer drawing its own;
 *   - ONE band order: the same category is the same slot in both bar layers, and
 *     a slot the second layer has no rows for stays EMPTY;
 *   - ONE margin box: the bar layers' plot rectangles are the same rectangle, so
 *     equal counts are equal heights;
 *   - a LINE ON THE BAND: the third layer's x is the category column, so each of
 *     its points sits at the bars' slot centre for that category — in PAGE
 *     pixels, across two charts with different margins of their own;
 *   - a click on the SECOND layer lands a real commit through that layer's own
 *     callback bundle;
 *
 * and, on the page's SECOND figure, the two-axis frame: two y axes, one at
 * each edge, x drawn once, and the frame's own sentence naming both fields —
 * the words that make two scales a figure and not a trick.
 *
 * Every selector is scoped to its figure (`[data-figure=…]`): the two frames
 * share one page, and a count over the whole page would be a count of neither.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { startGallery } from './serve.mjs';

const CHROME = process.env['VZF_CHROME']; // unset ⇒ playwright-core launches the headless shell it installed

/** The first figure — three layers, one guide. */
const ONE = '[data-figure="one-guide"]';
/** The second figure — two lines, two scales. */
const TWO = '[data-figure="two-scales"]';

/** Every bar of one layer: its accessible name (category + count) and where it sits. */
const barsOf = (page: Page, layerId: string): Promise<{ label: string; x: number; height: number }[]> =>
  page.locator(`${ONE} [data-layer="${layerId}"] rect.vzf-barrect`).evaluateAll((els) =>
    els.map((el) => ({ label: el.getAttribute('aria-label') ?? '', x: Number(el.getAttribute('x')), height: Number(el.getAttribute('height')) })),
  );

describe.skipIf(CHROME !== undefined && !existsSync(CHROME))('three layers on one frame (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startGallery>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    handle = await startGallery({ port: 0 });
    browser = await chromium.launch({ ...(CHROME !== undefined ? { executablePath: CHROME } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${handle.url}/frame`);
    await page.waitForSelector(`${ONE} .vzf-frame [data-layer="top"] rect.vzf-barrect`);
    await page.waitForSelector(`${TWO} .vzf-frame-caption`);
  }, 180_000);

  afterAll(async () => {
    await browser.close();
    await handle.close();
  });

  it('draws ONE guide for the stack — the frame’s, with the band names and the shared ceiling, and no layer drawing its own', async () => {
    expect(await page.locator(`${ONE} .vzf-frame-guide`).count()).toBe(1);
    // no layer drew an axis of its own: every axis line in the figure belongs to the guide
    expect(await page.locator(`${ONE} .vzf-frame-layer .vzf-axis`).count()).toBe(0);
    // textContent, not innerText: an SVG <text> has no inner TEXT box to lay out
    const ticks = await page.locator(`${ONE} .vzf-frame-guide text.vzf-tick`).evaluateAll((els) => els.map((el) => el.textContent));
    expect(ticks).toContain('Casual');
    expect(ticks).toContain('category'); // the merged axis label — the field both layers agree on
    expect(ticks).toContain('rows');
  });

  it('puts the same category over the same SLOT in both layers, and leaves a slot with no rows EMPTY', async () => {
    const all = await barsOf(page, 'all');
    const top = await barsOf(page, 'top');
    expect(all.length).toBeGreaterThan(1);
    // the second layer draws no more slots than the first, and every slot it draws is one of the first's
    expect(top.length).toBeLessThanOrEqual(all.length);
    const slots = new Map(all.map((bar) => [bar.label.split(' (')[0], bar.x]));
    for (const bar of top) expect(slots.get(bar.label.split(' (')[0])).toBe(bar.x);
    // the words say what an empty slot means, so the page never leaves it to be guessed
    expect(await page.locator('.vzf-frame-words').innerText()).toContain('empty');
  });

  it('measures the bar layers off ONE margin box: equal counts are equal heights', async () => {
    const boxes = await page.locator(`${ONE} .vzf-frame-layer`).evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect()).map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })));
    expect(boxes).toHaveLength(3);
    // the two bar layers have the same pads, so their boxes coincide exactly; the line's box is offset by ITS pad
    // (a line keeps 52px for its y ticks, a bar 38) — the frame offsets each layer so their PLOT rectangles coincide
    expect(boxes[1]).toEqual(boxes[0]);
    expect(boxes[2]).not.toEqual(boxes[0]);
    const all = await barsOf(page, 'all');
    const top = await barsOf(page, 'top');
    const heightOf = (bars: { label: string; height: number }[], label: string): number | undefined => bars.find((b) => b.label.startsWith(`select ${label} `))?.height;
    // a category whose 4★+ count equals its total count is drawn at exactly the same height in both layers
    for (const bar of top) {
      const category = bar.label.split(' (')[0]!.replace('select ', '');
      if (bar.label === all.find((a) => a.label.split(' (')[0] === `select ${category}`)?.label) expect(bar.height).toBe(heightOf(all, category));
    }
  });

  it('draws the LINE ON THE BAND: each of its points sits at the bars’ slot centre for its category, in page pixels, and its connectors join adjacent slots only', async () => {
    // the bar's slot centre per category, in page pixels — the rect's own box, not its svg attribute
    const slots = await page.locator(`${ONE} [data-layer="all"] rect.vzf-barrect`).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { category: (el.getAttribute('aria-label') ?? '').replace(/^select (\S+).*$/, '$1'), x: r.left + r.width / 2 };
      }),
    );
    // the line's dot per category, in page pixels — its <title> names the category first
    const dots = await page.locator(`${ONE} [data-layer="good"] circle.vzf-line-dot`).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { category: (el.querySelector('title')?.textContent ?? '').split(' · ')[0] ?? '', x: r.left + r.width / 2 };
      }),
    );
    expect(dots.length).toBeGreaterThan(1);
    const slotOf = new Map(slots.map((s) => [s.category, s.x]));
    for (const dot of dots) {
      expect(slotOf.has(dot.category), dot.category).toBe(true);
      // a bar's rect is 76% of its slot, centred, so its centre IS the slot centre; the dot is drawn at the same centre
      expect(Math.abs(dot.x - slotOf.get(dot.category)!), dot.category).toBeLessThan(1);
    }
    // the line drew no axis of its own (the guide is the frame's), and at least one connector
    expect(await page.locator(`${ONE} [data-layer="good"] .vzf-axis`).count()).toBe(0);
    expect(await page.locator(`${ONE} [data-layer="good"] path.vzf-line-path`).count()).toBeGreaterThanOrEqual(1);
    // the words say what a line on a band claims — and does not
    expect(await page.locator('.vzf-frame-words').innerText()).toContain('on a band there is no between');
  });

  it('a click on the SECOND layer lands a real commit through that layer’s own bundle', async () => {
    const readout = () => page.locator('.vzf-frame-readout').innerText();
    const commitsNow = async (): Promise<number> => Number((/(\d+) commits/.exec(await readout()) ?? ['', '0'])[1]);
    expect(await readout()).toContain('nothing yet');
    // the scripted session arrives with a log of its own — what this click must add is ONE
    const before = await commitsNow();
    await page.locator(`${ONE} [data-layer="top"] rect.vzf-barrect`).first().click();
    await page.waitForFunction(() => (document.querySelector('.vzf-frame-readout')?.textContent ?? '').includes('"top" layer'));
    // the emit is answered by the session, so the log grows a tick after the readout changes
    await page.waitForFunction((n) => Number((/(\d+) commits/.exec(document.querySelector('.vzf-frame-readout')?.textContent ?? '') ?? ['', '0'])[1]) > n, before);
    expect(await commitsNow()).toBe(before + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it('the SECOND figure draws two y axes, one at each edge, x once, and the sentence that names both fields', async () => {
    // the frame's own guide, once — the x, and no y of its own (its label is the x field the two lines agree on)
    expect(await page.locator(`${TWO} .vzf-frame-guide`).count()).toBe(1);
    const guideLabels = await page.locator(`${TWO} .vzf-frame-guide .vzf-frame-axislabel`).evaluateAll((els) => els.map((el) => el.textContent));
    expect(guideLabels).toEqual(['week']);
    // exactly two y-axis groups on the figure, one per line, and NO x-axis group on any line — x is the frame's
    const yAxes = await page.locator(`${TWO} .vzf-frame-layer .vzf-axis-group[data-axis-channel="y"]`).evaluateAll((els) =>
      els.map((el) => ({ layer: el.closest('[data-layer]')?.getAttribute('data-layer') ?? '', x: el.getBoundingClientRect().left, text: el.textContent ?? '' })),
    );
    expect(yAxes.map((a) => a.layer)).toEqual(['price', 'rating']);
    expect(await page.locator(`${TWO} .vzf-frame-layer .vzf-axis-group[data-axis-channel="x"]`).count()).toBe(0);
    // one at each edge: the price axis stands left of the plot, the rating axis right of it — in PAGE pixels
    const frameBox = await page.locator(`${TWO} .vzf-frame`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, mid: r.left + r.width / 2 };
    });
    expect(yAxes[0]!.x).toBeLessThan(frameBox.mid);
    expect(yAxes[1]!.x).toBeGreaterThan(frameBox.mid);
    expect(yAxes[0]!.text).toContain('price');
    expect(yAxes[1]!.text).toContain('rating');
    // the sentence, under the plot and in the accessible label, names both fields — left first
    const caption = await page.locator(`${TWO} .vzf-frame-caption`).innerText();
    expect(caption).toBe('two scales — left is price, right is rating; heights are not comparable across them');
    expect(await page.locator(`${TWO} .vzf-frame`).getAttribute('aria-label')).toContain(caption);
    // and the page's own words say why
    expect(await page.locator(`${TWO} .vzf-frame-words-two`).innerText()).toContain('declaration, never an inference');
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it('the SECOND figure draws the REAL means — the fixture’s own first week, recounted here, not merely two dots somewhere', async () => {
    // `galleryRows()` (./data.ts), the SAME seeded PRNG, recounted independently: week 2026-04-01's five rows —
    // price [35.97, 54.28, 23.53, 44.63, 40.14] mean 39.71, rating [1.3, 2, 1.1, 1.6, 2.6] mean 1.72 — the numbers
    // `weeklyMeanOf` (./frame.tsx) must have produced for the leftmost dot of each line
    const firstDotTitle = async (layerId: string): Promise<string> => (await page.locator(`${TWO} [data-layer="${layerId}"] circle.vzf-line-dot`).first().locator('title').textContent()) ?? '';
    const meanOf = (title: string): number => Number(/mean \S+ ([\d.]+) /.exec(title)?.[1] ?? NaN);
    const priceTitle = await firstDotTitle('price');
    const ratingTitle = await firstDotTitle('rating');
    expect(priceTitle).toContain('2026-04-01');
    expect(meanOf(priceTitle)).toBe(39.71);
    expect(ratingTitle).toContain('2026-04-01');
    expect(meanOf(ratingTitle)).toBe(1.72);
    // twelve weeks in, one dot each — the host aggregated to ONE row per week, never left it for the chart to guess
    expect(await page.locator(`${TWO} [data-layer="price"] circle.vzf-line-dot`).count()).toBe(12);
    expect(await page.locator(`${TWO} [data-layer="rating"] circle.vzf-line-dot`).count()).toBe(12);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
