/**
 * Playwright smoke test for the vizfootprint demo — real headless Chromium
 * (the pinned chrome-headless-shell 1208 the bench also uses) driving the two
 * live pages. Proves the gesture→commit→ledger wiring end-to-end AND that the
 * pages run with ZERO console errors. Screenshots both pages.
 *
 * Dashboard: a real brush drag → exactly ONE commit chip with a USER badge; the
 * agent button → an AGENT badge; Replay → the same chip sequence re-marked as
 * replayed. Analyst: Declare correlation → exactly ONE ledger row; five brushes
 * → still ONE ledger row (R6 — brushing never touches the ledger).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from './server.mjs';

const CHROME =
  process.env['VZF_CHROME']; // unset ⇒ playwright-core launches the headless shell it installed for its own version
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

describe.skipIf(CHROME !== undefined && !existsSync(CHROME))('demo smoke (real headless Chromium)', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    handle = await startServer({ port: 0 });
    browser = await chromium.launch({ ...(CHROME !== undefined ? { executablePath: CHROME } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1240, height: 940 } });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await handle?.close();
  });

  it('dashboard: brush → 1 user chip; agent button → agent badge; replay → replay markers', async () => {
    await page.goto(`${handle.url}/dashboard`);
    await page.waitForSelector('svg.scatter');

    // a real brush gesture → exactly ONE commit chip, tagged as the user
    await brush(page, 0.22, 0.72);
    await page.waitForSelector('[data-chip]');
    expect(await page.locator('[data-chip]').count()).toBe(1);
    expect(await page.locator('[data-chip] [data-actor="user"]').count()).toBe(1);
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBe(0);

    // the agent button → a second, visibly-different principal
    await page.locator('[data-action="agent"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-actor="agent"]').length >= 1);
    expect(await page.locator('[data-chip]').count()).toBe(2);
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBe(1);

    const chipsBefore = await page.locator('[data-chip]').count();

    // replay → same chip sequence, every chip re-marked as replayed (R2)
    await page.locator('[data-action="replay"]').click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-replayed="1"]').length === n,
      chipsBefore,
      { timeout: 5000 },
    );
    expect(await page.locator('[data-chip]').count()).toBe(chipsBefore);
    // badges survive the replay (still a user chip and an agent chip)
    expect(await page.locator('[data-chip] [data-actor="user"]').count()).toBe(1);
    expect(await page.locator('[data-chip] [data-actor="agent"]').count()).toBe(1);

    await page.screenshot({ path: path.join(SHOTS, 'dashboard.png'), fullPage: true });
  }, 60_000);

  it('analyst: declare correlation → 1 ledger row; 5 brushes → still 1 row (R6)', async () => {
    await page.goto(`${handle.url}/analyst`);
    await page.waitForSelector('svg.scatter');

    expect(await page.locator('table.ledger tbody tr').count()).toBe(0);

    await page.locator('[data-declare="correlation"]').click();
    await page.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length === 1, undefined, {
      timeout: 5000,
    });
    expect(await page.locator('table.ledger tbody tr').count()).toBe(1);
    // the honest headline is present and non-empty
    expect((await page.locator('[data-headline]').textContent())?.length ?? 0).toBeGreaterThan(10);

    // five brushes — the selection changes five times, the ledger must NOT grow
    for (let i = 0; i < 5; i++) {
      await brush(page, 0.1 + i * 0.06, 0.6 + i * 0.05);
      await page.waitForTimeout(30);
    }
    expect(await page.locator('table.ledger tbody tr').count()).toBe(1);

    await page.screenshot({ path: path.join(SHOTS, 'analyst.png'), fullPage: true });
  }, 60_000);

  it('analyst: "Run agent task" drives the REAL viz.dispatch/viz.declare_analysis tools — activity strip + ledger row', async () => {
    await page.goto(`${handle.url}/analyst`); // fresh session
    await page.waitForSelector('svg.scatter');

    expect(await page.locator('.activity-step').count()).toBe(0);
    expect(await page.locator('table.ledger tbody tr').count()).toBe(0);

    await page.locator('[data-action="run-agent-task"]').click();
    // the scripted agent makes 5 tool calls: whats_here, dispatch(filter),
    // declare_analysis(clustering), dispatch(select cluster), declare_analysis
    // (correlation) — plus a final whats_here read-back (6 total).
    await page.waitForFunction(() => document.querySelectorAll('.activity-step').length >= 6, undefined, {
      timeout: 10_000,
    });
    expect(await page.locator('.activity-step').count()).toBeGreaterThanOrEqual(6);
    // every activity row names the REAL tool it called (never a raw event).
    expect(await page.locator('.activity-step .tool').first().textContent()).toBe('viz.whats_here');

    await page.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length >= 1, undefined, {
      timeout: 5000,
    });
    expect(await page.locator('table.ledger tbody tr').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('.gap-row').count()).toBe(0); // the scripted task hits no gaps (R4)

    await page.screenshot({ path: path.join(SHOTS, 'analyst-agent.png'), fullPage: true });
  }, 60_000);

  it('analyst: the agent asking for a nonexistent column files exactly one typed gap', async () => {
    await page.goto(`${handle.url}/analyst`); // fresh session
    await page.waitForSelector('svg.scatter');

    expect(await page.locator('.gap-row').count()).toBe(0);
    await page.locator('[data-action="agent-gap"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.gap-row').length >= 1, undefined, { timeout: 5000 });
    expect(await page.locator('.gap-row').count()).toBe(1);
    expect(await page.locator('.gap-row[data-gap="needs-column"]').count()).toBe(1);
    expect(await page.locator('.activity-step').count()).toBe(1); // exactly the one tool call
  }, 30_000);

  it('both pages ran with zero console errors', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
