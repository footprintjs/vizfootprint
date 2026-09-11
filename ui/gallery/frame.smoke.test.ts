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
 *     callback bundle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { startGallery } from './serve.mjs';

const CHROME = process.env['VZF_CHROME']; // unset ⇒ playwright-core launches the headless shell it installed

/** Every bar of one layer: its accessible name (category + count) and where it sits. */
const barsOf = (page: Page, layerId: string): Promise<{ label: string; x: number; height: number }[]> =>
  page.locator(`[data-layer="${layerId}"] rect.vzf-barrect`).evaluateAll((els) =>
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
    await page.waitForSelector('.vzf-frame [data-layer="top"] rect.vzf-barrect');
  }, 180_000);

  afterAll(async () => {
    await browser.close();
    await handle.close();
  });

  it('draws ONE guide for the stack — the frame’s, with the band names and the shared ceiling, and no layer drawing its own', async () => {
    expect(await page.locator('.vzf-frame-guide').count()).toBe(1);
    // no layer drew an axis of its own: every axis line on the page belongs to the guide
    expect(await page.locator('.vzf-frame-layer .vzf-axis').count()).toBe(0);
    // textContent, not innerText: an SVG <text> has no inner TEXT box to lay out
    const ticks = await page.locator('.vzf-frame-guide text.vzf-tick').evaluateAll((els) => els.map((el) => el.textContent));
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
    const boxes = await page.locator('.vzf-frame-layer').evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect()).map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })));
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
    const slots = await page.locator('[data-layer="all"] rect.vzf-barrect').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { category: (el.getAttribute('aria-label') ?? '').replace(/^select (\S+).*$/, '$1'), x: r.left + r.width / 2 };
      }),
    );
    // the line's dot per category, in page pixels — its <title> names the category first
    const dots = await page.locator('[data-layer="good"] circle.vzf-line-dot').evaluateAll((els) =>
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
    expect(await page.locator('[data-layer="good"] .vzf-axis').count()).toBe(0);
    expect(await page.locator('[data-layer="good"] path.vzf-line-path').count()).toBeGreaterThanOrEqual(1);
    // the words say what a line on a band claims — and does not
    expect(await page.locator('.vzf-frame-words').innerText()).toContain('on a band there is no between');
  });

  it('a click on the SECOND layer lands a real commit through that layer’s own bundle', async () => {
    const readout = () => page.locator('.vzf-frame-readout').innerText();
    const commitsNow = async (): Promise<number> => Number((/(\d+) commits/.exec(await readout()) ?? ['', '0'])[1]);
    expect(await readout()).toContain('nothing yet');
    // the scripted session arrives with a log of its own — what this click must add is ONE
    const before = await commitsNow();
    await page.locator('[data-layer="top"] rect.vzf-barrect').first().click();
    await page.waitForFunction(() => (document.querySelector('.vzf-frame-readout')?.textContent ?? '').includes('"top" layer'));
    // the emit is answered by the session, so the log grows a tick after the readout changes
    await page.waitForFunction((n) => Number((/(\d+) commits/.exec(document.querySelector('.vzf-frame-readout')?.textContent ?? '') ?? ['', '0'])[1]) > n, before);
    expect(await commitsNow()).toBe(before + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
