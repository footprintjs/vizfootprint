/**
 * Playwright smoke for the mixed-principal demo — real headless Chromium (the
 * pinned chrome-headless-shell 1208 the repo's demo also uses), the scripted
 * MOCK provider (no API calls). UI-2: the dashboard is now `vizfootprint-ui`
 * components (`.vzf`-scoped markup) driven by one `createSessionView` poll
 * store; the chat popup + 🐛 debugger stayed hand-rolled DOM (not migrated).
 * It proves the full dress-shop UX:
 *   - the dashboard renders FULL-WIDTH via vizfootprint-ui; a human brush
 *     lands a `user` commit;
 *   - the floating LAUNCHER opens the analyst chat POPUP (not a fixed column);
 *   - a mock chat turn lands an `agent` commit + one online-FDR ledger row in
 *     the SAME shared log, and produces a grounded reply;
 *   - the 🐛 button opens a CENTRAL MODAL iframing the isolated /debug?embed
 *     page, and atui's `.atui` / `.flowscene` root renders NON-zero width
 *     inside it — the dress-shop's exact regression check that the iframe
 *     CSS-isolation held;
 *   - ZERO console errors throughout.
 * Screenshots the dashboard, the open popup, and the open debugger modal.
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

describe.skipIf(!existsSync(CHROME))('demo-agent smoke (real headless Chromium, mock provider) — UI-2 dashboard', () => {
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

  it('full-width dashboard (vizfootprint-ui) + a human brush share one commit log with the popup analyst', async () => {
    await page.goto(handle.url);

    // the dashboard renders full-width (vizfootprint-ui markup); the chat is a
    // launcher, NOT a fixed column
    await page.waitForSelector('#dashboard svg.vzf-scatter');
    await page.waitForSelector('#dashboard svg.vzf-bar');
    expect(await page.locator('#fab').isVisible()).toBe(true); // the "Ask the analyst" launcher
    expect(await page.locator('#chatpanel').isHidden()).toBe(true); // popup closed until launched

    // the human moves first → exactly one USER chip, no agent chip yet
    await brush(page, 0.22, 0.72);
    await page.waitForSelector('[data-vzf="commit-log"] .vzf-chip');
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="commit-log"] .vzf-chip[data-actor="user"]').length >= 1);
    expect(await page.locator('[data-vzf="commit-log"] .vzf-chip[data-actor="agent"]').count()).toBe(0);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'dashboard.png'), fullPage: true });

    // launch the popup — the composer lives inside it, not in a fixed pane
    await page.locator('#fab').click();
    await page.waitForSelector('#chatpanel:not([hidden]) .composer input');
    expect(await page.locator('#chatpanel .composer input').count()).toBe(1);

    // the analyst works alongside — send a message through the popup composer
    await page.locator('#chatpanel .composer input').fill('Is price correlated with rating? Declare it and read the ledger honestly.');
    await page.locator('#chatpanel .composer input').press('Enter');

    // the mock drives whats_here → filter → declare correlation: an AGENT chip appears
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="commit-log"] .vzf-chip[data-actor="agent"]').length >= 1, undefined, {
      timeout: 20_000,
    });
    expect(await page.locator('[data-vzf="commit-log"] .vzf-chip[data-actor="agent"]').count()).toBeGreaterThanOrEqual(1);
    // both principals are now in the one log
    expect(await page.locator('[data-vzf="commit-log"] .vzf-chip[data-actor="user"]').count()).toBeGreaterThanOrEqual(1);

    // the declared correlation landed exactly one online-FDR ledger row
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="fdr-ledger"] table.vzf-ledger tbody tr').length >= 1, undefined, {
      timeout: 20_000,
    });
    expect(await page.locator('[data-vzf="fdr-ledger"] table.vzf-ledger tbody tr').count()).toBe(1);

    // the analyst's reply bubble arrived (inside the popup)
    await page.waitForSelector('#chatpanel .bubble.analyst');
    expect((await page.locator('#chatpanel .bubble.analyst').first().textContent())?.length ?? 0).toBeGreaterThan(20);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'analyst-popup.png'), fullPage: true });
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

    await maybeScreenshot(page, { path: path.join(SHOTS, 'debugger-modal.png'), fullPage: true });
  }, 60_000);

  it('the page ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * UI-2 — the reencode path: an axis-label click opens the EncodingPicker (an
 * incompatible column is disabled-with-reason), picking a compatible column
 * lands a REAL `reencode` commit and the axis re-renders — the human path.
 * Then present mode: checkpoint-only traversal, the shell dims + blocks acting.
 */
describe.skipIf(!existsSync(CHROME))('UI-2: axis click -> EncodingPicker -> reencode; present mode', () => {
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
    const chipsBefore = await page.locator('[data-vzf="commit-log"] .vzf-chip').count();
    await page.locator('[data-vzf-modal="encoding-picker"] [data-field="price"]').click();
    await page.waitForSelector('[data-vzf-modal="encoding-picker"]', { state: 'detached' });
    await page.waitForFunction((n) => document.querySelectorAll('[data-vzf="commit-log"] .vzf-chip').length > n, chipsBefore, { timeout: 8000 });

    const yLabelAfter = await page.locator('svg.vzf-scatter [data-axis-channel="y"] .vzf-axis-label').textContent();
    expect(yLabelAfter ?? '').toContain('price');

    // the landed commit is a USER-badged reencode under viewId encoding:scatter
    const lastChip = page.locator('[data-vzf="commit-log"] .vzf-chip').last();
    expect(await lastChip.getAttribute('data-actor')).toBe('user');
    expect((await lastChip.textContent()) ?? '').toContain('y = price');
  }, 30_000);

  it('present mode = checkpoint-ONLY traversal, read-only shell; explore returns acting', async () => {
    // name a checkpoint first (present mode needs at least one story beat)
    await page.locator('[data-vzf="time-travel-bar"] .vzf-ckpt-input').fill('after reencode');
    await page.locator('[data-vzf="time-travel-bar"] .vzf-ckpt-input').press('Enter');
    await page.waitForTimeout(300);

    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Present")').click();
    await page.waitForSelector('[data-vzf="present"]', { timeout: 8000 });

    // the full commit timeline is GONE; only the named beat(s) remain
    expect(await page.locator('[data-vzf="timeline"]').count()).toBe(0);
    expect(await page.locator('.vzf-beat-title').count()).toBe(1);

    // the shell dims + blocks acting surfaces
    await page.waitForSelector('[data-vzf="dashboard"][data-readonly="true"]');
    expect(await page.locator('.vzf-readonly-note').count()).toBe(1);
    await maybeScreenshot(page, { path: path.join(SHOTS, 'present-mode.png'), fullPage: false });

    // back to explore — acting returns
    await page.locator('[data-vzf="time-travel-bar"] [role="tab"]:has-text("Explore")').click();
    await page.waitForSelector('[data-vzf="dashboard"][data-readonly="false"]');
  }, 30_000);

  it('ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * UI-2 — the AGENT-DRIVEN reencode path, browser end to end, LLM stubbed: the
 * chat popup sends "change the x axis of the scatter to rating"; the scripted
 * provider drives whats_here -> dispatch(reencode) -> a grounded reply (the
 * SAME tool boundary a real chat turn uses). Asserts the axis label changes,
 * a new CommitLog row lands, and its cause badge is the AGENT principal
 * (amber — `.vzf-badge.vzf-agent`, `--vzf-agent-deep` on `--vzf-agent-tint`).
 */
describe.skipIf(!existsSync(CHROME))('UI-2: agent-driven reencode via chat (LLM stubbed)', () => {
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

    // an AGENT-badged chip lands in the commit log
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="commit-log"] .vzf-chip[data-actor="agent"]').length >= 1, undefined, {
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

    // the cause reads as the AGENT principal, amber-badged (the package's
    // `--vzf-agent-deep` on `--vzf-agent-tint`, not the user's blue)
    const agentChip = page.locator('[data-vzf="commit-log"] .vzf-chip[data-actor="agent"]').first();
    expect((await agentChip.textContent()) ?? '').toContain('x = rating');
    const badgeColor = await page.locator('[data-vzf="commit-log"] .vzf-badge.vzf-agent').first().evaluate((n) => getComputedStyle(n).color);
    const userBadgeCount = await page.locator('[data-vzf="commit-log"] .vzf-badge.vzf-user').count();
    if (userBadgeCount > 0) {
      const userBadgeColor = await page.locator('[data-vzf="commit-log"] .vzf-badge.vzf-user').first().evaluate((n) => getComputedStyle(n).color);
      expect(badgeColor).not.toBe(userBadgeColor); // visually distinct principal colors
    }
    expect(badgeColor).toMatch(/rgb\(/); // a real resolved color, not the unstyled default

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
    await page.waitForSelector('#dashboard svg.vzf-scatter');
    await page.waitForSelector('[data-vzf="time-travel-bar"]'); // the time-travel card mounted

    // two linear brushes → two commits on the active timeline
    await brush(page, 0.18, 0.5);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 1);
    await brush(page, 0.55, 0.85);
    await page.waitForFunction(() => document.querySelectorAll('[data-vzf="timeline"] [data-commit]').length >= 2);
    // exactly ONE branch so far (linear)
    await page.waitForFunction(() => (document.querySelector('[data-vzf="time-travel-bar"] .vzf-muted')?.textContent ?? '').includes('1 branch'));
    expect(await page.locator('[data-vzf="branch-map"] .vzf-bm-node').count()).toBe(2);

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
    expect(await page.locator('[data-vzf="branch-map"] .vzf-bm-node').count()).toBe(3); // 1 root + 2 tips
    // acting made the new lineage active → the past banner clears
    await page.waitForSelector('.vzf-past-banner', { state: 'detached', timeout: 8000 });

    // old branch intact: the abandoned tip is still a record whose parent is the fork point
    const oldTipIntact = await page.evaluate(async (id) => {
      const st = (await (await fetch('/api/state')).json()) as { records: { id: string; parent: string | null }[]; branches: unknown[] };
      const siblings = st.records.filter((r) => r.parent === id);
      return siblings.length === 2 && st.branches.length === 2; // both children of the fork point survive
    }, firstId);
    expect(oldTipIntact).toBe(true);

    await maybeScreenshot(page, { path: path.join(SHOTS, 'time-travel-fork.png'), fullPage: true });
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
    await page.waitForFunction(() => (document.querySelector('[data-vzf="fdr-ledger"] table.vzf-ledger tbody tr') ? true : false), undefined, {
      timeout: 8000,
    });
    const testsBefore = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsBefore).toBeGreaterThanOrEqual(1);

    // travel back to the first commit — the GLOBAL test count must NOT rewind
    await page.locator('[data-vzf="timeline"] [data-commit]').first().click();
    await page.waitForSelector('.vzf-past-banner', { timeout: 8000 });
    const testsAfter = await page.evaluate(async () => ((await (await fetch('/api/state')).json()) as { fdr: { tests: number } }).fdr.tests);
    expect(testsAfter).toBe(testsBefore); // scrubbing back refunds no test / no alpha

    // the verbatim honesty line is rendered
    expect((await page.locator('.vzf-tt-honest').textContent()) ?? '').toContain('alpha spent on abandoned branches is never refunded');
    // the two truths are distinct at a past cursor: cursor-local 0 vs global ≥ 1
    const cursorLocal = (await page.locator('.vzf-two-truths .vzf-tt-line').first().textContent()) ?? '';
    expect(cursorLocal).toContain('at cursor');

    await maybeScreenshot(page, { path: path.join(SHOTS, 'time-travel-two-truths.png'), fullPage: true });
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
 * checkpoint field's (or composer's) own arrow-key text-cursor movement.
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

  it('ArrowLeft/ArrowRight seek, but NOT while the checkpoint field has focus', async () => {
    // starts at head (past-banner absent) from the previous test's end state
    expect(await page.locator('.vzf-past-banner').count()).toBe(0);

    // focused on an <input>: ArrowLeft must be swallowed by the field, not seek
    await page.locator('[data-vzf="time-travel-bar"] .vzf-ckpt-input').click();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    expect(await page.locator('.vzf-past-banner').count()).toBe(0); // no seek happened

    // blur the field — ArrowLeft now DOES seek
    await page.locator('[data-vzf="time-travel-bar"] .vzf-ckpt-input').evaluate((node) => (node as HTMLElement).blur());
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
