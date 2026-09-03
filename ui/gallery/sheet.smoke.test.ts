// @vitest-environment node
/**
 * Playwright smoke over the SHEET page — real headless Chromium, a real
 * in-process session of 90,300 rows. It proves the three things a grid over an
 * engine has to get right:
 *   - the first paint is ONE window, and a scroll stop costs ONE more (the
 *     block cache), while a scroll back costs none;
 *   - a row click lands EXACTLY ONE commit, on the declared key column;
 *   - the refusals are said in words (a cell edit), and nothing is logged to
 *     the console throughout.
 * The Workbook's two tabs are here too: the Sheet does not ask for windows
 * while it sits behind the Sources tab.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { startGallery } from './serve.mjs';

const CHROME = process.env['VZF_CHROME']; // unset ⇒ playwright-core launches the headless shell it installed

const windowsAsked = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __sheetWindows: number }).__sheetWindows);
const commits = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __sheetCommits: () => number }).__sheetCommits());
const readout = (page: Page): Promise<string> => page.locator('.vzf-sheet-readout').innerText();

/** Scroll the grid's body and wait for the window that stop asked for to land. */
async function scrollTo(page: Page, top: number, expectRows: string): Promise<void> {
  await page.evaluate((y) => {
    const body = document.querySelector('.vzf-sheet-body');
    if (body !== null) body.scrollTop = y;
  }, top);
  await page.waitForFunction((words) => (document.querySelector('.vzf-sheet-readout')?.textContent ?? '').startsWith(words), expectRows);
}

describe.skipIf(CHROME !== undefined && !existsSync(CHROME))('the Sheet over 90,300 rows (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startGallery>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    handle = await startGallery({ port: 0 });
    browser = await chromium.launch({ ...(CHROME !== undefined ? { executablePath: CHROME } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1180, height: 640 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
      if (m.type() === 'warning') consoleWarnings.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${handle.url}/sheet`);
    await page.waitForSelector('.vzf-sheet-rows [role="row"]');
  }, 180_000);

  afterAll(async () => {
    await browser.close();
    await handle.close();
  });

  it('paints the first window of 90,300 rows with the declared key frozen first', async () => {
    expect(await readout(page)).toContain('of 90,300');
    expect(await readout(page)).toContain('version ');
    const heads = await page.locator('[role="columnheader"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')));
    expect(heads[0]).toBe('id'); // the declared row key leads and is frozen
    expect(heads).toContain('report_state');
    const rows = await page.locator('.vzf-sheet-rows [role="row"]').count();
    expect(rows).toBeGreaterThan(10);
    expect(rows).toBeLessThan(40); // virtualized: the DOM holds a window, never 90,300 rows
    expect(await windowsAsked(page)).toBe(1);
  });

  it('one window per scroll stop — and a scroll back costs none', async () => {
    const before = await windowsAsked(page);
    await scrollTo(page, 28 * 30, 'rows 31'); // inside the block already held
    expect(await windowsAsked(page)).toBe(before);
    await scrollTo(page, 28 * 4000, 'rows 4,001'); // a new block: exactly one more window
    expect(await windowsAsked(page)).toBe(before + 1);
    await scrollTo(page, 28 * 30, 'rows 31'); // back where the block still is
    expect(await windowsAsked(page)).toBe(before + 1);
  });

  it('a row click lands EXACTLY ONE commit, on the declared key — and stays one after it has settled', async () => {
    expect(await commits(page)).toBe(0);
    await page.locator('.vzf-sheet-rows [role="row"]').first().click();
    await page.waitForFunction(() => (window as unknown as { __sheetCommits: () => number }).__sheetCommits() === 1);
    // settle: a second look after a pause, so a late second commit cannot hide behind the first assertion
    await page.waitForTimeout(250);
    expect(await commits(page)).toBe(1);
    await page.waitForTimeout(250);
    expect(await commits(page)).toBe(1);
    // the sheet's own clause never hides the sheet's rows: the engine excludes it
    await page.waitForFunction(() => (document.querySelector('.vzf-sheet-readout')?.textContent ?? '').includes('of 90,300'));
    // the row it picked is the one marked
    expect(await page.locator('.vzf-sheet-picked').count()).toBe(1);
  });

  it('a cell edit is refused in words, and the double-click\'s FIRST click is the only selection it makes', async () => {
    await page.locator('.vzf-sheet-rows [role="gridcell"][data-column="cases"]').first().dblclick();
    await page.waitForSelector('.vzf-sheet-refused');
    expect(await page.locator('.vzf-sheet-refused').innerText()).toContain('the sheet is read-only in this version; annotate the row instead');
    await page.waitForTimeout(250);
    // one commit from the row-click test, one from this double-click's first click — never three
    expect(await commits(page)).toBe(2);
  });

  it('behind the Sources tab the sheet asks for nothing', async () => {
    const before = await windowsAsked(page);
    await page.locator('[role="tab"]', { hasText: 'Sources' }).click();
    await page.waitForSelector('[data-vzf="sources"]');
    expect(await page.locator('.vzf-sheet').count()).toBe(0);
    await page.locator('[role="tab"]', { hasText: 'Sheet' }).click();
    await page.waitForSelector('.vzf-sheet-rows [role="row"]');
    expect(await windowsAsked(page)).toBe(before + 1); // one window when it comes back, not one per tab
  });

  // last, because narrowing the window re-measures the sheet's height and costs a window
  it('a table wider than its box scrolls sideways, and the header rides with it', async () => {
    await page.setViewportSize({ width: 520, height: 640 });
    await page.waitForSelector('.vzf-sheet-rows [role="row"]');
    const moved = await page.evaluate(() => {
      const body = document.querySelector('.vzf-sheet-body') as HTMLElement | null;
      /* the sheet is mounted: the body is there */
      if (body === null) return -1;
      body.scrollLeft = 200;
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
      return body.scrollLeft;
    });
    expect(moved).toBeGreaterThan(0); // the six columns really are wider than a 520px box
    await page.waitForFunction(() => (document.querySelector('.vzf-sheet-head') as HTMLElement | null)?.scrollLeft === (document.querySelector('.vzf-sheet-body') as HTMLElement | null)?.scrollLeft);
    await page.setViewportSize({ width: 1180, height: 640 });
  });

  it('zero console errors AND zero warnings throughout (this page runs React\'s development build on purpose)', () => {
    expect(consoleErrors).toEqual([]);
    expect(consoleWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * ABOVE THE CAP. 400,000 rows × 28px is 11.2M pixels — past the 10M canvas the
 * sheet will build, so the scrollbar becomes a scaled ruler. The thing that
 * must still be true: the bottom of the scroll IS the bottom of the table, and
 * the browser's own maximum scroll is exactly the canvas the sheet drew (no
 * phantom space under the last row).
 */
describe.skipIf(CHROME !== undefined && !existsSync(CHROME))('the Sheet above the canvas cap (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startGallery>>;
  let browser: Browser;
  let page: Page;
  const problems: string[] = [];

  beforeAll(async () => {
    handle = await startGallery({ port: 0 });
    browser = await chromium.launch({ ...(CHROME !== undefined ? { executablePath: CHROME } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1180, height: 640 } });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(`${handle.url}/sheet?rows=400000`);
    await page.waitForSelector('.vzf-sheet-rows [role="row"]', { timeout: 120_000 });
  }, 180_000);

  afterAll(async () => {
    await browser.close();
    await handle.close();
  });

  it('caps the canvas and still reaches the LAST row at the bottom of the scroll', async () => {
    await page.waitForFunction(() => (document.querySelector('.vzf-sheet-readout')?.textContent ?? '').includes('of 400,000'));
    const canvas = await page.locator('.vzf-sheet-canvas').evaluate((el) => el.getBoundingClientRect().height);
    expect(canvas).toBe(10_000_000); // 11.2M would not lay out

    const at = await page.evaluate(() => {
      const body = document.querySelector('.vzf-sheet-body') as HTMLElement;
      body.scrollTop = body.scrollHeight; // ask for everything the browser will give
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
      return { top: body.scrollTop, max: body.scrollHeight - body.clientHeight };
    });
    expect(at.top).toBe(at.max); // the browser gave us its maximum, and it is the one the sheet drew
    expect(at.max).toBeGreaterThan(9_999_000);

    await page.waitForSelector('[data-row="399999"]', { timeout: 30_000 });
    expect(await page.locator('[data-row="399999"] [data-column="id"]').innerText()).toBe('c399999');
    expect(await page.locator('.vzf-sheet-readout').innerText()).toMatch(/rows 399,9\d\d–400,000 of 400,000/); // the last screenful, whatever the box's height makes it

    // the rows layer never reaches past the canvas, so the maximum scroll IS the canvas minus the box
    const after = await page.evaluate(() => {
      const body = document.querySelector('.vzf-sheet-body') as HTMLElement;
      return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, top: body.scrollTop };
    });
    expect(after.scrollHeight).toBe(10_000_000);
    expect(after.top).toBe(after.scrollHeight - after.clientHeight);
  });

  it('nothing was logged on the way', () => {
    expect(problems).toEqual([]);
  });
});
