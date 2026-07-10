// @vitest-environment jsdom
/**
 * Coverage packet COV-demo — closes demo/src/analyst.ts (URL 2: declared
 * analyses + online FDR + the Mode-B agent panel) from 0% to full statement/
 * branch/function/line coverage.
 *
 * Same self-mounting shape as dashboard.ts (`void mountAnalyst(document.
 * getElementById('app'))` on import) — every test goes through `freshMount`.
 * Same jsdom brush-gesture technique as the other two coverage files
 * (MouseEvents typed as pointer events, a `getBoundingClientRect` stub).
 *
 * Fixture datasets are hand-tuned (verified with a throwaway pearson/
 * normalApproxPValue script against the real formulas in src/analysis/
 * stats.ts and src/fdr/lordPlusPlus.ts / gamma.ts) to land specific,
 * REAL outcomes: a perfect-enough correlation for an actual FDR DISCOVERY,
 * a moderate one for "significant but not a discovery", a flat one for
 * "not significant", a constant-rating slice for a genuine degenerate fit,
 * and row counts that cross the regression honesty floor (10 points) in
 * both directions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
  delete (window as unknown as { __viz?: unknown }).__viz;
});

// ── fixtures ───────────────────────────────────────────────────────────────

// Prices are chosen so that `quantileBins(price, k=4)` over all 15 rows
// (rank order == insertion order here, already sorted) puts ranks 8-11
// (prices 70/90/110/125) in bin 2 — and those four prices ALSO sit inside the
// scripted agent task's own hardcoded `range:[60,130]` filter. Their ratings
// (2,3,4,5) climb cleanly with price, so the agent's own end-of-script
// "declare correlation over cluster 2 ∩ price∈[60,130]" lands a REAL,
// non-degenerate test (verified: r≈0.998, n=4) instead of an empty selection
// — the only way to reach `summarizeResult`'s `analysis.fdrStep` truthy arm
// via this file's actual scripted call, not a synthetic one.
const MAIN_CSV = `id,category,price,rating
m1,Casual,10,2
m2,Formal,15,2.5
m3,Party,20,3
m4,Work,25,2
m5,Summer,30,3.5
m6,Casual,35,3
m7,Formal,40,4
m8,Party,50,3.5
m9,Work,70,2
m10,Summer,90,3
m11,Casual,110,4
m12,Formal,125,5
m13,Party,150,4
m14,Work,170,4.5
m15,Summer,190,5
`;

// Header-only — zero data rows (needs-column on every field; see
// dashboard.coverage.test.ts for the same, verified-empirically trick).
const EMPTY_CSV = `id,category,price,rating\n`;

// Every row shares rating=3 exactly (zero y-variance) — `pearson`'s
// `denom===0` arm fires for real, so `correlationAnalysis` genuinely returns
// `{ok:false, reason:'degenerate-fit'}` over the FULL default selection.
const FLAT_RATING_CSV = `id,category,price,rating
f1,Casual,10,3
f2,Formal,20,3
f3,Party,30,3
f4,Work,40,3
f5,Summer,50,3
`;

// r ≈ 0.618, n=15 → p ≈ 0.0046 (verified). LORD++'s own first threshold is
// ≈0.000272 (w0=alpha/2=0.025, gamma(1)≈0.010928) — so this is significant
// alone (p<=0.05) but NOT a discovery (p > threshold).
const MODERATE_CORR_CSV = `id,category,price,rating
c1,Casual,10,2
c2,Formal,20,3
c3,Party,30,2
c4,Work,40,4
c5,Summer,50,3
c6,Casual,60,2
c7,Formal,70,4
c8,Party,80,3
c9,Work,90,5
c10,Summer,100,3
c11,Casual,110,4
c12,Formal,120,5
c13,Party,130,3
c14,Work,140,5
c15,Summer,150,4
`;

// r ≈ 0.926, n=15 → p ≈ 0 (underflows below LORD++'s first threshold) → a
// real DISCOVERY on the first test.
const STRONG_CORR_CSV = `id,category,price,rating
s1,Casual,10,1
s2,Formal,20,1.5
s3,Party,30,2
s4,Work,40,1
s5,Summer,50,2.5
s6,Casual,60,2
s7,Formal,70,3
s8,Party,80,2.5
s9,Work,90,3
s10,Summer,100,3.5
s11,Casual,120,3
s12,Formal,140,4
s13,Party,160,3.5
s14,Work,180,4
s15,Summer,200,5
`;

// r = 0 exactly (perfectly alternating, symmetric around the mean) → p ≈ 1.
const NO_CORR_CSV = `id,category,price,rating
n1,Casual,10,3
n2,Formal,20,4
n3,Party,30,3
n4,Work,40,4
n5,Summer,50,3
n6,Casual,60,4
n7,Formal,70,3
n8,Party,80,4
n9,Work,90,3
n10,Summer,100,4
n11,Casual,110,3
n12,Formal,120,4
n13,Party,130,3
n14,Work,140,4
n15,Summer,150,3
`;

// Fewer than REGRESSION_MIN_POINTS (10) rows total — the R14 honesty floor.
const TINY_CSV = `id,category,price,rating
t1,Casual,10,2
t2,Formal,20,3
t3,Party,30,4
t4,Work,40,3
t5,Summer,50,4
`;

// A rating bucket of exactly 8 rows (rating=3.5) — `declareDegenerate`'s
// `.find((b) => b.length >= 8)` succeeds (the "bucket found" arm).
const BUCKET8_CSV = `id,category,price,rating
b1,Casual,10,3.5
b2,Formal,20,3.5
b3,Party,30,3.5
b4,Work,40,3.5
b5,Summer,50,3.5
b6,Casual,60,3.5
b7,Formal,70,3.5
b8,Party,80,3.5
`;

// No rating repeats >=8 times (every value distinct or repeats <=2x) — the
// `.find` fails, so `declareDegenerate` falls back to `rows.slice(0,8)`
// (verified via script: r ≈ NaN here — constant price, varied rating — so
// the fallback ALSO lands the genuine degenerate flag).
const NO_BUCKET_DEGENERATE_CSV = `id,category,price,rating
u1,Casual,100,1
u2,Formal,100,2
u3,Party,100,3
u4,Work,100,4
u5,Summer,100,5
u6,Casual,100,1
u7,Formal,100,2
u8,Party,100,3
`;

// Same "no bucket >=8" property, but these 8 rows have real x/y variance
// (verified via script: r ≈ 0.9999, finite) — so `declareDegenerate`'s own
// correlation SUCCEEDS on a set the demo calls "degenerate", landing the
// `degenerate === false` ("unexpected: got a result on a degenerate set")
// arm for real.
const NO_BUCKET_NORMAL_CSV = `id,category,price,rating
v1,Casual,10,1
v2,Formal,30,2
v3,Party,50,3
v4,Work,20,1.5
v5,Summer,60,3.5
v6,Casual,40,2.5
v7,Formal,70,4
v8,Party,15,1.2
`;

interface Gap {
  code: string;
  op: string;
  detail: string;
}

interface Viz {
  ledgerLength(): number;
  declareCorrelation(): Promise<void>;
  declareDegenerate(): Promise<void>;
  runAgentTask(): Promise<void>;
  runAgentGapDemo(): Promise<void>;
  gaps(): Gap[];
}

function getViz(): Viz {
  return (window as unknown as { __viz: Viz }).__viz;
}

async function freshMount(csv: string): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => csv }) as Response),
  );
  await import('./analyst.js');
  await vi.waitFor(() => {
    if (!(window as unknown as { __viz?: unknown }).__viz) throw new Error('not mounted yet');
  });
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function stageForBrush(svg: SVGSVGElement): void {
  (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 520, height: 340, right: 520, bottom: 340, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
}

function ptr(type: string, clientX: number): Event {
  const ev = new MouseEvent(type, { clientX, clientY: 10, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  return ev;
}

function scatterEl(): SVGSVGElement {
  return document.querySelector('svg.scatter') as unknown as SVGSVGElement;
}

function selReadoutText(): string {
  return document.querySelector('.sel-readout')!.textContent!;
}

function ledgerRowCount(): number {
  return document.querySelectorAll('table.ledger tbody tr').length;
}

async function declareViaButton(id: string): Promise<void> {
  const before = document.querySelectorAll('.result-card > *').length;
  document.querySelector<HTMLButtonElement>(`[data-declare="${id}"]`)!.click();
  await vi.waitFor(() => {
    if (document.querySelectorAll('.result-card > *').length === 0) throw new Error('waiting for result card');
    if (document.querySelectorAll('.result-card > *').length === before && before !== 0) {
      // allow same-length (e.g. re-declare) — just require the card exists
    }
  });
  // let the trailing `await refreshLedger()` (a second microtask hop) settle too
  await flush();
}

describe('mountAnalyst — initial render', () => {
  it('renders the grid, the empty ledger, zero gaps, and the full selection count', async () => {
    await freshMount(MAIN_CSV);
    expect(selReadoutText()).toBe('current selection: 15 of 15 rows');
    expect(ledgerRowCount()).toBe(0);
    expect(document.querySelector('.gaps')!.textContent).toContain('Gaps — unmet requests (0)');
    expect(document.querySelector('.muted')!.textContent).toBe('no gaps filed');
    expect(document.querySelectorAll('.declare').length).toBe(5);
    expect(getViz().gaps()).toEqual([]);
    expect(getViz().ledgerLength()).toBe(0);
  });
});

describe('scatter brush → commitFilter (ok:true) and the live transient preview', () => {
  it('a real drag lands a filter commit and narrows the selection readout (the live preview touches only chart highlighting, never `selectedRows()`)', async () => {
    await freshMount(MAIN_CSV);
    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 60));
    svg.dispatchEvent(ptr('pointermove', 300));
    await flush();
    // `applyTransient` pushes straight onto `session.log.selection` (bypassing
    // `InteractionSession`'s own `activeFilters` fold) — so the readout, which
    // reads `session.selectedRows()`, is UNCHANGED mid-drag. Only the
    // scatter's own highlighting (via `predicateFor`/`specBySource`) is live.
    expect(selReadoutText()).toBe('current selection: 15 of 15 rows');

    svg.dispatchEvent(ptr('pointerup', 300));
    await vi.waitFor(() => {
      if (selReadoutText() === 'current selection: 15 of 15 rows') throw new Error('waiting for the commit to land');
    });
    expect(selReadoutText()).toMatch(/^current selection: \d+ of 15 rows$/);
  });

  it('a click (no real drag) clears via `commitFilter(..., null)` — the "clear" intent branch', async () => {
    await freshMount(MAIN_CSV);
    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 200));
    svg.dispatchEvent(ptr('pointerup', 201)); // 1px — below the drag threshold, `onBrushCommit(null)`
    await flush();
    expect(selReadoutText()).toBe('current selection: 15 of 15 rows'); // nothing to clear — still full
  });
});

describe('bar click → commitSelect (ok:true)', () => {
  it('clicking a bar narrows the selection to that category', async () => {
    await freshMount(MAIN_CSV);
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[0]!.dispatchEvent(new Event('click', { bubbles: true })); // 'Casual' — 3 rows
    await vi.waitFor(() => {
      if (selReadoutText() === 'current selection: 15 of 15 rows') throw new Error('waiting for the select to land');
    });
    expect(selReadoutText()).toBe('current selection: 3 of 15 rows');
  });
});

describe('commitFilter/commitSelect (ok:false) — a real needs-column rejection', () => {
  it('a scatter brush against an empty dataset lands no commit (needs-column on "price")', async () => {
    await freshMount(EMPTY_CSV);
    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 60));
    svg.dispatchEvent(ptr('pointermove', 300));
    svg.dispatchEvent(ptr('pointerup', 300));
    await flush();
    expect(selReadoutText()).toBe('current selection: 0 of 0 rows');
  });

  it('a bar click against an empty dataset lands no commit (needs-column on "category") — commitSelect\'s own `if (result.ok)` false arm', async () => {
    await freshMount(EMPTY_CSV);
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[0]!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    expect(selReadoutText()).toBe('current selection: 0 of 0 rows');
  });
});

describe('render() — the bar-counts loop tolerates a category outside the fixed CATEGORIES list', () => {
  it('a row whose category is not one of the five declared bars still counts (the `counts.get(...) ?? 0` fallback)', async () => {
    const csvWithExtraCategory = `id,category,price,rating
e1,Casual,20,2
e2,Vintage,80,3
`;
    await freshMount(csvWithExtraCategory);
    expect(document.querySelectorAll('svg.bar rect.barrect').length).toBe(5);
    expect(selReadoutText()).toBe('current selection: 2 of 2 rows');
  });
});

describe('declareCorrelation', () => {
  it('a normal selection yields a real scalar r and steps the ledger once', async () => {
    await freshMount(MODERATE_CORR_CSV);
    await declareViaButton('correlation');
    expect(document.querySelector('.result-card .analysis-title')!.textContent).toBe('correlation (price × rating)');
    expect(document.querySelector('.result-card')!.textContent).toMatch(/Pearson r = 0\.\d+ over 15 rows/);
    expect(ledgerRowCount()).toBe(1);
    expect(document.querySelector('[data-headline]')!.textContent).toContain('significant alone, NOT a discovery');
  });

  it('a genuinely zero-variance selection is honestly flagged degenerate — no r, no ledger row', async () => {
    await freshMount(FLAT_RATING_CSV);
    await declareViaButton('correlation');
    const flag = document.querySelector('.result-card .flag.r14')!;
    expect(flag.textContent).toContain('honest degenerate-fit flag (R14)');
    expect(flag.textContent).toContain('n=5');
    expect(ledgerRowCount()).toBe(0);
  });

  it('a strong correlation crosses LORD++\'s own first threshold — a real DISCOVERY row', async () => {
    await freshMount(STRONG_CORR_CSV);
    await declareViaButton('correlation');
    expect(ledgerRowCount()).toBe(1);
    expect(document.querySelector('table.ledger tr.discovery')).not.toBeNull();
    expect(document.querySelector('[data-headline]')!.textContent).toContain('DISCOVERY');
  });

  it('an uncorrelated selection is honestly "not significant"', async () => {
    await freshMount(NO_CORR_CSV);
    await declareViaButton('correlation');
    expect(ledgerRowCount()).toBe(1);
    expect(document.querySelector('[data-headline]')!.textContent).toContain('not significant (threshold');
  });
});

describe('declareDegenerate — the built-in 8-collinear-points demo', () => {
  it('when a rating bucket of >=8 exists, uses it and flags degenerate honestly — ledger untouched', async () => {
    await freshMount(BUCKET8_CSV);
    const before = getViz().ledgerLength();
    document.querySelector<HTMLButtonElement>('[data-declare="degenerate"]')!.click();
    await vi.waitFor(() => {
      if (document.querySelectorAll('.result-card > *').length === 0) throw new Error('waiting');
    });
    await flush();
    const text = document.querySelector('.result-card')!.textContent!;
    expect(text).toContain('DEGENERATE demo');
    expect(text).toContain('R14 honest flag: degenerate-fit');
    expect(getViz().ledgerLength()).toBe(before); // (0 → 0) — no wealth spent
  });

  it('when no bucket reaches 8, falls back to the first 8 rows — still degenerate here (constant price)', async () => {
    await freshMount(NO_BUCKET_DEGENERATE_CSV);
    document.querySelector<HTMLButtonElement>('[data-declare="degenerate"]')!.click();
    await vi.waitFor(() => {
      if (document.querySelectorAll('.result-card > *').length === 0) throw new Error('waiting');
    });
    await flush();
    expect(document.querySelector('.result-card')!.textContent).toContain('R14 honest flag: degenerate-fit');
  });

  it('when no bucket reaches 8 AND the fallback 8 rows are NOT degenerate, honestly says so (the "unexpected" arm)', async () => {
    await freshMount(NO_BUCKET_NORMAL_CSV);
    document.querySelector<HTMLButtonElement>('[data-declare="degenerate"]')!.click();
    await vi.waitFor(() => {
      if (document.querySelectorAll('.result-card > *').length === 0) throw new Error('waiting');
    });
    await flush();
    expect(document.querySelector('.result-card')!.textContent).toContain('unexpected: got a result on a degenerate set');
  });
});

describe('declareClustering + selectCluster (the ordinary-predicate re-entry path, R11)', () => {
  it('materializes cluster_id, renders the cluster chip list, and a chip click selects an ordinary point predicate', async () => {
    await freshMount(MAIN_CSV);
    await declareViaButton('clustering');
    const text = document.querySelector('.result-card')!.textContent!;
    expect(text).toContain('clustering (price → cluster_id, k=4)');
    expect(text).toContain('landed via the L5 session');
    expect(ledgerRowCount()).toBe(0); // kind:transform — no ledger row

    const chips = [...document.querySelectorAll('.cluster-chip')];
    expect(chips.length).toBe(4);
    expect(chips.map((c) => c.textContent)).toEqual(['cluster 0', 'cluster 1', 'cluster 2', 'cluster 3']);

    chips[0]!.dispatchEvent(new Event('click', { bubbles: true }));
    await vi.waitFor(() => {
      if (!document.querySelector('.result-card')!.textContent!.includes('cluster 0 selected')) throw new Error('waiting');
    });
    expect(document.querySelector('.result-card')!.textContent).toMatch(/cluster 0 selected.*session selection: \d+ rows/s);
  });
});

describe('declareRegression — the R14 honesty floor', () => {
  it('>=10 points fits a real OLS line and draws the overlay', async () => {
    await freshMount(MAIN_CSV);
    await declareViaButton('regression');
    const text = document.querySelector('.result-card')!.textContent!;
    expect(text).toContain('regression (price → rating)');
    expect(text).toMatch(/slope=-?\d+\.\d+ {2}intercept=-?\d+\.\d+/);
    expect(document.querySelector('svg.scatter line.regline')).not.toBeNull();
  });

  it('<10 points hits the honesty floor — no line fit, no overlay', async () => {
    await freshMount(TINY_CSV);
    await declareViaButton('regression');
    const flag = document.querySelector('.result-card .flag.r14')!;
    expect(flag.textContent).toContain('R14 honesty floor: only 5 points');
    expect(document.querySelector('svg.scatter line.regline')).toBeNull();
  });

  it('a SECOND declare after a successful fit clears a previous overlay when it then floors (regression line cleanup)', async () => {
    await freshMount(MAIN_CSV);
    await declareViaButton('regression');
    expect(document.querySelector('svg.scatter line.regline')).not.toBeNull();
    // narrow the selection below the floor via a bar click that leaves <10 rows, then re-declare
    document.querySelector<HTMLButtonElement>('svg.bar rect.barrect')!.dispatchEvent(new Event('click', { bubbles: true }));
    await vi.waitFor(() => {
      if (selReadoutText() === 'current selection: 15 of 15 rows') throw new Error('waiting for the bar select');
    });
    await declareViaButton('regression');
    expect(document.querySelector('svg.scatter line.regline')).toBeNull();
  });
});

describe('declareGroupBy', () => {
  it('renders a per-category summary table with string + numeric cell formatting', async () => {
    await freshMount(MAIN_CSV);
    await declareViaButton('groupby');
    expect(document.querySelector('.result-card .analysis-title')!.textContent).toBe('group-by (category → mean price)');
    const table = document.querySelector('table.gb-table')!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['category', 'count', 'price_mean']);
    const firstRow = [...table.querySelectorAll('tbody tr')[0]!.children].map((td) => td.textContent);
    // category (string) via String(v); count/price_mean (numbers) via toFixed(2)
    expect(firstRow[0]).toBe('Casual');
    expect(firstRow[1]).toMatch(/^\d+\.00$/);
    expect(firstRow[2]).toMatch(/^\d+\.\d{2}$/);
    expect(ledgerRowCount()).toBe(0);
  });
});

describe('the agent panel — driven ONLY through vizAsTools (Mode B)', () => {
  it('"Run agent task" makes the scripted 6-call sequence, renders the activity strip, and never re-enters while running', async () => {
    await freshMount(MAIN_CSV);
    const btn = document.querySelector<HTMLButtonElement>('[data-action="run-agent-task"]')!;
    // Drive it through the REAL DOM button (not the `window.__viz` shortcut)
    // so the toolbar's own `() => void runAgentTask()` click handler is
    // exercised too, not just the function it wraps.
    btn.click();
    // the reentrancy guard: a second call while the first is still running is
    // a no-op — the disabled button itself would swallow a real second click,
    // so this calls the underlying function directly to prove the function's
    // OWN `if (agentRunning) return;` guard (not just the disabled attribute).
    const p2 = getViz().runAgentTask();
    expect(btn.disabled).toBe(true);
    await p2;
    await vi.waitFor(() => {
      if (btn.disabled) throw new Error('waiting for the real run to finish');
    });

    const steps = [...document.querySelectorAll('.activity-step')];
    expect(steps.length).toBeGreaterThanOrEqual(6);
    expect(steps[0]!.querySelector('.tool')!.textContent).toBe('viz.whats_here');
    expect(steps.map((s) => s.querySelector('.tool')!.textContent)).toContain('viz.dispatch');
    expect(steps.map((s) => s.querySelector('.tool')!.textContent)).toContain('viz.declare_analysis');
    // one step's args include the array-valued `range` (exercises the array
    // branch of `summarizeValue`, which recurses into its two integers).
    const dispatchStep = steps.find((s) => s.querySelector('.args')!.textContent!.includes('range='));
    expect(dispatchStep!.querySelector('.args')!.textContent).toContain('range=[60,130]');
    // the clustering declare_analysis step's result names the materialized column
    const declareSteps = steps.filter((s) => s.querySelector('.tool')!.textContent === 'viz.declare_analysis');
    expect(declareSteps.some((s) => s.querySelector('.result')!.textContent!.includes('materialized=[cluster_id]'))).toBe(true);
    // the cluster list mid-task mirror + the ledger both got refreshed
    expect(document.querySelectorAll('.cluster-chip').length).toBe(4);
  }, 15_000);

  it('the gap-demo button asks for a column that was never declared — files exactly one typed gap, and the LONG intent string is truncated in the activity strip', async () => {
    await freshMount(MAIN_CSV);
    document.querySelector<HTMLButtonElement>('[data-action="agent-gap"]')!.click();
    await vi.waitFor(() => {
      if (document.querySelectorAll('.gap-row').length === 0) throw new Error('waiting for the gap');
    });
    expect(document.querySelectorAll('.gap-row').length).toBe(1);
    const row = document.querySelector('.gap-row')!;
    expect(row.getAttribute('data-gap')).toBe('needs-column');
    expect(row.querySelector('.gap-op')!.textContent).toBe('select');
    expect(row.querySelector('.gap-detail')!.textContent).toContain('discount_pct');
    expect(document.querySelectorAll('.activity-step').length).toBe(1);
    // "agent asks for a column that does not exist" is 45 chars (>32) — the
    // `summarizeValue` string-truncation branch (`"${v.slice(0,29)}…"`).
    const argsText = document.querySelector('.activity-step .args')!.textContent!;
    expect(argsText).toContain('…"');
    expect(argsText).not.toContain('does not exist');
    expect(getViz().gaps().length).toBe(1);
    expect(getViz().gaps()[0]!.code).toBe('needs-column');
  });
});
