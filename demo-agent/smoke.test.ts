/**
 * Playwright smoke for the mixed-principal demo — real headless Chromium (the
 * pinned chrome-headless-shell 1208 the repo's demo also uses), the scripted
 * MOCK provider (no API calls). UX-2: the dashboard is now the FLAGSHIP
 * `<VizCockpit>` (`.vzf`-scoped markup) driven by one `createSessionView` poll
 * store — a single viewport, zero page scroll, report chips opening large
 * frosted-glass modals (Commit log / Branch map / FDR ledger / Analyses /
 * Gaps / 🐛 Analyst debugger). The floating chat popup stayed hand-rolled DOM
 * (it's a popup, not a page panel). It proves the full dress-shop UX:
 *   - the cockpit renders full-viewport; a human brush lands a `user` commit;
 *   - the floating LAUNCHER opens the analyst chat POPUP (not a fixed column);
 *   - a mock chat turn lands an `agent` commit + one online-FDR ledger row in
 *     the SAME shared log (both visible once their report chips are opened),
 *     and produces a grounded reply;
 *   - the 🐛 chip (both from the status strip AND from "See the thinking"
 *     under a reply) opens the SAME large modal iframing the isolated
 *     /debug?embed page, and atui's `.atui`/`.flowscene` root renders
 *     NON-zero width inside it — the dress-shop's exact regression check
 *     that the iframe CSS-isolation held;
 *   - ZERO page/shell scroll at desktop AND mobile viewports;
 *   - ZERO console errors throughout.
 * Screenshots the dashboard, the open popup, an open report modal, the 🐛
 * modal, and the mobile carousel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from './server.mjs';
import { scriptedReencodeMock } from './src/analyst.js';

const CHROME =
  '/Users/sanjay/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'screenshots');

// Screenshot bytes are nondeterministic (antialiasing/timing), so a plain
// `npx vitest run` must NOT rewrite the committed PNGs — that leaves the git
// tree dirty on every run. Refresh them deliberately with:
//   UPDATE_SCREENSHOTS=1 npx vitest run demo-agent/smoke.test.ts
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

async function brush(page: Page, fromFrac: number, toFrac: number): Promise<void> {
  const box = await page.locator('svg.vzf-scatter').boundingBox();
  if (!box) throw new Error('scatter not found');
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((fromFrac + toFrac) / 2), y, { steps: 6 });
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 6 });
  await page.mouse.up();
}

/** Open a report chip and wait for its modal dialog. */
async function openReport(page: Page, id: string): Promise<void> {
  await page.locator(`[data-report="${id}"]`).click();
  await page.waitForSelector(`[data-vzf-modal="report-${id}"] [role="dialog"]`);
}

describe.skipIf(!existsSync(CHROME))('demo-agent smoke (real headless Chromium, mock provider) — the cockpit', () => {
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

  it('the cockpit renders full-viewport with zero page/shell scroll; a human brush lands a commit visible once the commits chip opens', async () => {
    await page.goto(handle.url);

    // the cockpit fills the page (the whole-viewport shell, not a fixed column);
    // the chat is a launcher, NOT a fixed column
    await page.waitForSelector('#dashboard svg.vzf-scatter');
    await page.waitForSelector('#dashboard svg.vzf-bar');
    expect(await page.locator('#fab').isVisible()).toBe(true); // the "Ask the analyst" launcher
    expect(await page.locator('#chatpanel').isHidden()).toBe(true); // popup closed until launched
    await expectNoPageOrShellScroll(page);

    // the human moves first → exactly one USER commit lands (badged on the chip)
    await brush(page, 0.22, 0.72);
    await page.waitForFunction(() => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) >= 1);
    await openReport(page, 'commits');
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="user"]').length >= 1);
    expect(await page.locator('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="agent"]').count()).toBe(0);
    // scroll lives INSIDE the modal body, never the page
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('[data-vzf-modal="report-commits"] .vzf-modal-body')!).overflowY),
    ).toBe('auto');
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'dashboard.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });

    // launch the popup — the composer lives inside it, not in a fixed pane
    await page.locator('#fab').click();
    await page.waitForSelector('#chatpanel:not([hidden]) .composer input');
    expect(await page.locator('#chatpanel .composer input').count()).toBe(1);

    // the analyst works alongside — send a message through the popup composer
    await page.locator('#chatpanel .composer input').fill('Is price correlated with rating? Declare it and read the ledger honestly.');
    await page.locator('#chatpanel .composer input').press('Enter');

    // the mock drives whats_here → filter → declare correlation: an AGENT commit lands
    await page.waitForFunction(() => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) >= 2, undefined, {
      timeout: 20_000,
    });

    // both principals are now in the one log (open the chip to see the mixed log)
    await openReport(page, 'commits');
    expect(await page.locator('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="user"]').count()).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });

    // the declared correlation landed exactly one online-FDR ledger row (its own chip)
    await openReport(page, 'ledger');
    await page.waitForSelector('[data-vzf-modal="report-ledger"] table.vzf-ledger tbody tr');
    expect(await page.locator('[data-vzf-modal="report-ledger"] table.vzf-ledger tbody tr').count()).toBe(1);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-ledger"]', { state: 'detached' });

    // the analyst's reply bubble arrived (inside the popup)
    await page.waitForSelector('#chatpanel .bubble.analyst');
    expect((await page.locator('#chatpanel .bubble.analyst').first().textContent())?.length ?? 0).toBeGreaterThan(20);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'analyst-popup.png'), fullPage: false });
  }, 60_000);

  it('the 🐛 "See the thinking" button and the status-strip Debug chip open the SAME modal; atui renders NON-zero width in the iframe', async () => {
    // the 🐛 button sits under the analyst reply
    const dbgBtn = page.locator('#chatpanel .dbgbtn').first();
    await dbgBtn.waitFor({ timeout: 20_000 });
    await dbgBtn.click();

    // a large frosted-glass modal (the cockpit's OWN report system) iframes the
    // isolated /debug?embed page — no separate hand-rolled modal anymore
    await page.waitForSelector('[data-vzf-modal="report-debug"] iframe');
    const frame = page.frameLocator('[data-vzf-modal="report-debug"] iframe');

    // THE regression check: atui's root renders with real width — proving the host
    // dashboard's global CSS did NOT leak into the iframe and collapse its layout.
    const atui = frame.locator('.atui');
    await atui.waitFor({ timeout: 15_000 });
    const box = await atui.boundingBox();
    expect(box?.width ?? 0, 'atui root width must be > 0 (iframe isolation held)').toBeGreaterThan(0);
    const scene = await frame.locator('.flowscene').first().boundingBox();
    expect(scene?.width ?? 0, 'atui .flowscene width must be > 0').toBeGreaterThan(0);
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'debugger-modal.png'), fullPage: false });

    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-debug"]', { state: 'detached' });

    // close the floating popup first — it's a fixed overlay that can sit over
    // the status strip at this viewport, same as a real user would dismiss it
    await page.locator('#chatclose').click();
    await page.waitForSelector('#chatpanel', { state: 'hidden' });

    // the SAME modal opens from the status-strip chip directly (one debug modal, not two)
    await page.locator('[data-report="debug"]').click();
    await page.waitForSelector('[data-vzf-modal="report-debug"] iframe');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-debug"]', { state: 'detached' });
  }, 60_000);

  it('the page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * UX-2 — the reencode path: an axis-label click opens the EncodingPicker (an
 * incompatible column is disabled-with-reason), picking a compatible column
 * lands a REAL `reencode` commit and the axis re-renders — the human path.
 * Then: naming a checkpoint via the ⚑ modal, and present mode (checkpoint-only
 * traversal, the shell dims + blocks acting).
 */
describe.skipIf(!existsSync(CHROME))('UX-2: axis click -> EncodingPicker -> reencode; ⚑ checkpoint modal; present mode', () => {
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
    await page.goto(handle.url);
    await page.waitForSelector('svg.vzf-scatter');
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await handle?.close();
  });

  it('an axis click opens the encoding picker; an incompatible column is disabled-with-reason; a compatible pick reencodes', async () => {
    const yLabelBefore = await page.locator('svg.vzf-scatter [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabelBefore ?? '').toContain('rating');

    await page.locator('svg.vzf-scatter [data-axis-channel="y"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"] [role="dialog"]');

    // honest disabled-with-reason: a string column cannot ride a positional (y) channel
    const catOpt = page.locator('[data-vzf-modal="encoding-picker"] [data-field="category"]');
    expect(await catOpt.isDisabled()).toBe(true);
    expect((await catOpt.getAttribute('title')) ?? '').toContain('numeric or date');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'encoding-picker.png'), fullPage: false });

    // pick price for y → dispatch({verb:'reencode'}) → a new commit lands + the scatter re-renders
    const commitsBefore = Number(await page.locator('[data-report="commits"] .vzf-report-badge').textContent());
    await page.locator('[data-vzf-modal="encoding-picker"] [data-field="price"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });
    await page.waitForFunction((n) => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) > n, commitsBefore, {
      timeout: 8000,
    });

    const yLabelAfter = await page.locator('svg.vzf-scatter [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabelAfter ?? '').toContain('price');

    // the landed commit is a USER-badged reencode under viewId encoding:scatter
    await openReport(page, 'commits');
    const lastChip = page.locator('[data-vzf-modal="report-commits"] .vzf-chip').last();
    expect(await lastChip.getAttribute('data-actor')).toBe('user');
    expect((await lastChip.textContent()) ?? '').toContain('y = price');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });
  }, 30_000);

  it('⚑ opens the checkpoint naming modal; Enter lands a REAL checkpoint, then present mode = checkpoint-ONLY traversal, read-only shell', async () => {
    // name a checkpoint through the ⚑ modal first (present mode needs at least one story beat)
    await page.locator('[data-vzf="checkpoint-open"]').click();
    await page.waitForSelector('[data-vzf-modal="checkpoint"] [role="dialog"]');
    expect(await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-name').evaluate((el) => el === document.activeElement)).toBe(true);
    expect((await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-target').textContent()) ?? '').toContain('marks commit #');
    await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-name').fill('after reencode');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-vzf-modal="checkpoint"]', { state: 'detached' });
    await page.waitForSelector('[data-vzf="timeline"] .vzf-tl-flag', { timeout: 8000 });

    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Present")').click();
    await page.waitForSelector('[data-vzf="present"]', { timeout: 8000 });

    // the full commit timeline is GONE; only the named beat(s) remain
    expect(await page.locator('[data-vzf="timeline"]').count()).toBe(0);
    expect(await page.locator('.vzf-beat-title').count()).toBe(1);

    // the shell dims + blocks acting surfaces
    await page.waitForSelector('[data-vzf="cockpit"][data-readonly="true"]');
    expect(await page.locator('.vzf-readonly-note').count()).toBe(1);
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'present-mode.png'), fullPage: false });

    // back to explore — acting returns
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Explore")').click();
    await page.waitForSelector('[data-vzf="cockpit"][data-readonly="false"]');
  }, 30_000);

  it('ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * UX-2 — the AGENT-DRIVEN reencode path, browser end to end, LLM stubbed: the
 * chat popup sends "change the x axis of the scatter to rating"; the scripted
 * provider drives whats_here -> dispatch(reencode) -> a grounded reply (the
 * SAME tool boundary a real chat turn uses). Asserts the axis label changes,
 * a new commits-chip badge increments, and (once the commits chip is opened)
 * the landed row's cause badge is the AGENT principal (amber —
 * `.vzf-badge.vzf-agent`, `--vzf-agent-deep` on `--vzf-agent-tint`).
 */
describe.skipIf(!existsSync(CHROME))('UX-2: agent-driven reencode via chat (LLM stubbed)', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startServer({ port: 0, mock: true, provider: scriptedReencodeMock() });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
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

  it('"change the x axis of the scatter to rating" re-renders the axis, lands an agent commit, amber-badged', async () => {
    const xLabelBefore = await page.locator('svg.vzf-scatter [data-axis-channel="x"] .vzf-axis-label').textContent();
    expect(xLabelBefore ?? '').toContain('price');

    await page.locator('#fab').click();
    await page.waitForSelector('#chatpanel:not([hidden]) .composer input');
    await page.locator('#chatpanel .composer input').fill('change the x axis of the scatter to rating');
    await page.locator('#chatpanel .composer input').press('Enter');

    // an AGENT commit lands (badge increments)
    await page.waitForFunction(() => Number(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent) >= 1, undefined, {
      timeout: 20_000,
    });

    // the axis re-rendered: x now reads "rating"
    await page.waitForFunction(
      () => (document.querySelector('svg.vzf-scatter [data-axis-channel="x"] .vzf-axis-label')?.textContent ?? '').includes('rating'),
      undefined,
      { timeout: 8000 },
    );
    const xLabelAfter = await page.locator('svg.vzf-scatter [data-axis-channel="x"] .vzf-axis-label').textContent();
    expect(xLabelAfter ?? '').toContain('rating');

    // open the commits chip: the cause reads as the AGENT principal, amber-badged
    // (the package's `--vzf-agent-deep` on `--vzf-agent-tint`, not the user's blue)
    await openReport(page, 'commits');
    const agentChip = page.locator('[data-vzf-modal="report-commits"] .vzf-chip[data-actor="agent"]').first();
    expect(await agentChip.count()).toBeGreaterThanOrEqual(1);
    expect((await agentChip.textContent()) ?? '').toContain('x = rating');
    const badgeColor = await page.locator('[data-vzf-modal="report-commits"] .vzf-badge.vzf-agent').first().evaluate((n) => getComputedStyle(n).color);
    const userBadgeCount = await page.locator('[data-vzf-modal="report-commits"] .vzf-badge.vzf-user').count();
    if (userBadgeCount > 0) {
      const userBadgeColor = await page
        .locator('[data-vzf-modal="report-commits"] .vzf-badge.vzf-user')
        .first()
        .evaluate((n) => getComputedStyle(n).color);
      expect(badgeColor).not.toBe(userBadgeColor); // visually distinct principal colors
    }
    expect(badgeColor).toMatch(/rgb\(/); // a real resolved color, not the unstyled default
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-commits"]', { state: 'detached' });

    // the analyst's reply bubble arrived
    await page.waitForSelector('#chatpanel .bubble.analyst');
    expect((await page.locator('#chatpanel .bubble.analyst').first().textContent())?.length ?? 0).toBeGreaterThan(0);

    await maybeScreenshot(page, { path: path.join(SHOTS, 'agent-reencode.png'), fullPage: true });
  }, 30_000);

  it('ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * Phase B — the cockpit's TIME-TRAVEL bar (real headless Chromium, mock provider):
 *   - a timeline of the active branch's commits (always visible in the top
 *     strip) + a branch-map git-graph render (behind its own report chip);
 *   - brush → seek back (click a past commit) → brush again SPROUTS a second
 *     branch, and the old branch stays intact (2 lineages in the map);
 *   - a declared test's GLOBAL ledger count survives travelling back (never
 *     un-counted), and the two-truths honesty line is rendered verbatim
 *     (inside the FDR ledger chip's modal);
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
    await page.waitForSelector('#dashboard svg.vzf-scatter');
    await page.waitForSelector('[data-vzf="time-travel-bar"]'); // the time-travel strip mounted

    // two linear brushes → two commits on the active timeline (always visible, top strip)
    await brush(page, 0.18, 0.5);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 1);
    await brush(page, 0.55, 0.85);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 2);
    // exactly ONE branch so far (linear)
    await page.waitForFunction(() => (document.querySelector('[data-vzf="time-travel-bar"] .vzf-muted')?.textContent ?? '').includes('1 branch'));
    await openReport(page, 'branches');
    expect(await page.locator('[data-vzf-modal="report-branches"] .vzf-bm-node').count()).toBe(2);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-branches"]', { state: 'detached' });

    // seek BACK to the first commit by clicking its timeline dot → the viewing-past banner shows
    const firstDot = page.locator('[data-vzf="timeline"] [data-commit]').first();
    const firstId = await firstDot.getAttribute('data-commit');
    await firstDot.click();
    await page.waitForSelector('.vzf-past-banner', { timeout: 8000 });
    expect(await page.locator('.vzf-past-banner').isVisible()).toBe(true);
    // the cursor marker is on the first commit in both timeline + branch map
    await page.waitForFunction(
      (id) => document.querySelector(`[data-vzf="timeline"] [data-commit="${id}"]`)?.classList.contains('vzf-cursor') === true,
      firstId,
    );

    // act from the PAST → brush again → a SIBLING branch sprouts (two lineages)
    await brush(page, 0.6, 0.92);
    await page.waitForFunction(() => (document.querySelector('[data-vzf="time-travel-bar"] .vzf-muted')?.textContent ?? '').includes('2 branch'), undefined, {
      timeout: 8000,
    });
    await openReport(page, 'branches');
    expect(await page.locator('[data-vzf-modal="report-branches"] .vzf-bm-node').count()).toBe(3); // 1 root + 2 tips
    await maybeScreenshot(page, { path: path.join(SHOTS, 'time-travel-fork.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-branches"]', { state: 'detached' });
    // acting made the new lineage active → the past banner clears
    await page.waitForSelector('.vzf-past-banner', { state: 'detached', timeout: 8000 });

    // old branch intact: the abandoned tip is still a record whose parent is the fork point
    const oldTipIntact = await page.evaluate(async (id) => {
      const st = (await (await fetch('/api/state')).json()) as { records: { id: string; parent: string | null }[]; branches: unknown[] };
      const siblings = st.records.filter((r) => r.parent === id);
      return siblings.length === 2 && st.branches.length === 2; // both children of the fork point survive
    }, firstId);
    expect(oldTipIntact).toBe(true);
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
    await page.waitForFunction(() => Number(document.querySelector('[data-report="ledger"] .vzf-report-badge')?.textContent) >= 0, undefined, {
      timeout: 8000,
    });
    const testsBefore = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsBefore).toBeGreaterThanOrEqual(1);

    // travel back to the first commit — the GLOBAL test count must NOT rewind
    await page.locator('[data-vzf="timeline"] [data-commit]').first().click();
    await page.waitForSelector('.vzf-past-banner', { timeout: 8000 });
    const testsAfter = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsAfter).toBe(testsBefore); // scrubbing back refunds no test / no alpha

    // the verbatim honesty line is rendered inside the ledger chip's modal
    await openReport(page, 'ledger');
    expect((await page.locator('[data-vzf-modal="report-ledger"] .vzf-tt-honest').textContent()) ?? '').toContain(
      'alpha spent on abandoned branches is never refunded',
    );
    // the two truths are distinct at a past cursor: cursor-local 0 vs global ≥ 1
    const cursorLocal = (await page.locator('[data-vzf-modal="report-ledger"] .vzf-two-truths .vzf-tt-line').first().textContent()) ?? '';
    expect(cursorLocal).toContain('at cursor');
    await maybeScreenshot(page, { path: path.join(SHOTS, 'time-travel-two-truths.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-ledger"]', { state: 'detached' });
  }, 60_000);

  it('the time-travel page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * Phase C — step navigation (real headless Chromium, mock provider): the
 * ⟵/⟶ buttons AND ArrowLeft/ArrowRight move the cursor (charts + readout
 * re-render), disable correctly at the root/leaf edges, never hijack the
 * checkpoint modal's own arrow-key text-cursor movement.
 * ZERO console errors. Screenshots the bar.
 */
describe.skipIf(!existsSync(CHROME))('step navigation — ⟵/⟶ buttons + keyboard', () => {
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

  it('step buttons start disabled, then move the cursor + re-render as the history grows; disabled again at the edges', async () => {
    await page.goto(handle.url);
    await page.waitForSelector('#dashboard svg.vzf-scatter');
    await page.waitForSelector('[data-vzf="time-travel-bar"]');

    // no commits yet: both step buttons start disabled
    await page.waitForFunction(() => (document.querySelector('[data-step="back"]') as HTMLButtonElement | null)?.disabled === true);
    expect(await page.locator('[data-step="forward"]').isDisabled()).toBe(true);

    // three linear brushes → a 3-commit chain on the (single, active) lane
    await brush(page, 0.1, 0.35);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 1);
    await brush(page, 0.4, 0.6);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 2);
    await brush(page, 0.65, 0.9);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 3);

    // at the (leaf) head: forward disabled, back enabled (there is a parent)
    expect(await page.locator('[data-step="forward"]').isDisabled()).toBe(true);
    expect(await page.locator('[data-step="back"]').isDisabled()).toBe(false);
    const xLabelAtHead = await page.locator('svg.vzf-scatter [data-axis-channel="x"] .vzf-axis-label').textContent();

    // ⟵ Step back TWICE → lands on the ROOT
    await page.locator('[data-step="back"]').click();
    await page.waitForSelector('.vzf-past-banner', { timeout: 8000 });
    await page.locator('[data-step="back"]').click();
    await page.waitForFunction(() => (document.querySelector('[data-step="back"]') as HTMLButtonElement | null)?.disabled === true, undefined, {
      timeout: 8000,
    });

    // ⟶ Step forward TWICE → symmetric return to the (single-lane) head
    await page.locator('[data-step="forward"]').click();
    await page.waitForFunction(() => (document.querySelector('[data-step="back"]') as HTMLButtonElement | null)?.disabled === false, undefined, {
      timeout: 8000,
    });
    await page.locator('[data-step="forward"]').click();
    await page.waitForSelector('.vzf-past-banner', { state: 'detached', timeout: 8000 });
    await page.waitForFunction(() => (document.querySelector('[data-step="forward"]') as HTMLButtonElement | null)?.disabled === true, undefined, {
      timeout: 8000,
    });
    const xLabelBackAtHead = await page.locator('svg.vzf-scatter [data-axis-channel="x"] .vzf-axis-label').textContent();
    expect(xLabelBackAtHead).toBe(xLabelAtHead); // same cursor again → same axis label

    await maybeScreenshot(page, { path: path.join(SHOTS, 'time-travel-step-nav.png'), fullPage: true });
  }, 60_000);

  it('ArrowLeft/ArrowRight seek, but NOT while the checkpoint modal\'s name field has focus', async () => {
    // starts at head (past-banner absent) from the previous test's end state
    expect(await page.locator('.vzf-past-banner').count()).toBe(0);

    // the ⚑ modal autofocuses its name field: ArrowLeft must be swallowed by
    // the field, not seek
    await page.locator('[data-vzf="checkpoint-open"]').click();
    await page.waitForSelector('[data-vzf-modal="checkpoint"] [role="dialog"]');
    expect(await page.locator('[data-vzf-modal="checkpoint"] .vzf-ckpt-name').evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    expect(await page.locator('.vzf-past-banner').count()).toBe(0); // no seek happened

    // Esc cancels the modal — ArrowLeft now DOES seek
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="checkpoint"]', { state: 'detached' });
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.vzf-past-banner', { timeout: 8000 });

    // ArrowRight steps forward again, back to the head
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.vzf-past-banner', { state: 'detached', timeout: 8000 });
  }, 30_000);

  it('the step-navigation page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * Mobile viewport (real headless Chromium, mock provider): the charts band
 * becomes a horizontally swipeable scroll-snap carousel with dot indicators —
 * still ZERO page/shell scroll, the same cockpit invariant as desktop. The
 * time strip stays pinned top and the chip strip pinned bottom.
 */
describe.skipIf(!existsSync(CHROME))('mobile viewport — scroll-snap chart carousel, still zero page scroll', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startServer({ port: 0, mock: true });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    page = await browser.newPage({ viewport: { width: 390, height: 740 } });
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

  it('the EMPTY session (a fresh visitor) keeps the top strip one slim row — the "no commits yet" hint never wraps into a tall column', async () => {
    // regression: .vzf-tl-empty used to wrap its long hint into a one-word-wide
    // column inside the squeezed compact track, ballooning the (stretch-aligned)
    // top strip to ~250px at 390px width until the first commit landed.
    const m = await page.evaluate(() => {
      const top = document.querySelector('[data-vzf="cockpit-top"]')!.getBoundingClientRect();
      const empty = document.querySelector('.vzf-tl-empty')!.getBoundingClientRect();
      return { topH: top.height, emptyH: empty.height };
    });
    expect(m.topH, 'empty-state top strip stays one slim row (was ~250px before the fix)').toBeLessThan(90);
    expect(m.emptyH, 'the hint renders on ONE line (nowrap + ellipsis), never a wrapped column').toBeLessThan(40);
    await expectNoPageOrShellScroll(page);
  }, 30_000);

  it('renders a two-page dot carousel with zero page/shell scroll; tapping a dot swipes to that chart', async () => {
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

    // tapping the second dot swipes to the bar chart page and activates the dot
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
    await expectNoPageOrShellScroll(page);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'mobile.png'), fullPage: false });
  }, 30_000);

  it('the status strip + its report chips still open a modal that scrolls internally, not the page', async () => {
    await openReport(page, 'gaps');
    const modal = await page.evaluate(() => {
      const body = document.querySelector('[data-vzf-modal="report-gaps"] .vzf-modal-body') as HTMLElement;
      return { bodyOverflowY: getComputedStyle(body).overflowY };
    });
    expect(modal.bodyOverflowY, 'the modal body owns any overflow, even on mobile').toBe('auto');
    await expectNoPageOrShellScroll(page);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-vzf-modal="report-gaps"]', { state: 'detached' });
  }, 30_000);

  it('the mobile page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
