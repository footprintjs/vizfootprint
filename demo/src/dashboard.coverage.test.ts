// @vitest-environment jsdom
/**
 * Coverage packet COV-demo — closes demo/src/dashboard.ts (URL 1: the
 * coordination + provenance story) from 0% to full statement/branch/
 * function/line coverage.
 *
 * `dashboard.ts`'s last line self-mounts (`void mountDashboard(document.
 * getElementById('app'))`) the instant the module is evaluated, so EVERY
 * test here goes through `freshMount(csv)`: `vi.resetModules()` (a fresh
 * module graph, so the auto-mount runs again from scratch), seed `#app`,
 * stub `fetch` to answer `/data/dresses.csv`, dynamically `import()`, then
 * poll for the `window.__viz` hook `mountDashboard` sets as its very last
 * statement (proof the async mount actually finished).
 *
 * jsdom implements no layout and no PointerEvent/setPointerCapture at all
 * (verified empirically) — brush gestures dispatch `MouseEvent`s typed as
 * the pointer event names (addEventListener matches by type STRING) against
 * a `getBoundingClientRect` stub pinned to the chart's own 520x340 viewBox,
 * exactly as in common.coverage.test.ts.
 *
 * Self-exclusion note (see the file header of dashboard.ts): brushing the
 * SCATTER filters the BAR but never dims the scatter's own dots (Mosaic
 * crossfilter self-exclusion) — assertions on "did the brush take effect"
 * read the bar's counts, not scatter dot classes.
 *
 * `renderChips` REPLACES every chip DOM node on each render (`replaceChildren`
 * rebuilds from scratch) — a chip reference captured before a click that
 * re-renders is stale afterward; every assertion below re-queries the DOM
 * after an action that triggers a re-render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
  delete (window as unknown as { __viz?: unknown }).__viz;
});

const NORMAL_CSV = `id,category,price,rating
d1,Casual,20,2
d2,Formal,60,3
d3,Party,100,4
d4,Work,140,3.5
d5,Summer,180,5
d6,Casual,220,2.5
`;

// Header-only — zero data rows. `memoryProvider`'s `columnNamesOf([])` returns
// `[]` (verified in src/data/memoryProvider.ts), so EVERY select/filter on
// this dataset gets a real `needs-column` rejection — the natural, real way
// to drive the `commitDispatch`/`applyRecord` "the dispatch was rejected"
// arms this demo's own wiring otherwise never exercises (every field name it
// dispatches on is a real column whenever there is at least one row).
const EMPTY_CSV = `id,category,price,rating\n`;

interface VizRecord {
  id: string;
  parent: string | null;
  kind: string;
  field: string;
  value: unknown;
  cause: { requestedBy: string; intent?: string };
}

interface Viz {
  records(): VizRecord[];
  simulateAgentBrush(): Promise<void>;
  replaySession(): void;
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
  await import('./dashboard.js');
  await vi.waitFor(() => {
    if (!(window as unknown as { __viz?: unknown }).__viz) throw new Error('not mounted yet');
  });
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

/** A settle point for the async `session.dispatch` chain when NO state change is expected. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** A real drag gesture that is expected to land exactly one new commit. */
async function dragAndWaitForCommit(fromX: number, toX: number): Promise<void> {
  const before = getViz().records().length;
  const svg = scatterEl();
  stageForBrush(svg);
  svg.dispatchEvent(ptr('pointerdown', fromX));
  svg.dispatchEvent(ptr('pointermove', toX));
  svg.dispatchEvent(ptr('pointerup', toX));
  await vi.waitFor(() => {
    if (getViz().records().length <= before) throw new Error('waiting for the drag to commit');
  });
}

function barCount(category: string): string {
  const idx = ['Casual', 'Formal', 'Party', 'Work', 'Summer'].indexOf(category);
  return document.querySelectorAll('svg.bar text.barval')[idx]!.textContent!;
}

describe('mountDashboard — initial render', () => {
  it('renders the toolbar, both charts, and the empty history strip', async () => {
    await freshMount(NORMAL_CSV);
    expect(document.querySelectorAll('.btn').length).toBe(4); // replay, fork, agent, reset
    expect(document.querySelector('svg.scatter')).not.toBeNull();
    expect(document.querySelector('svg.bar')).not.toBeNull();
    expect(document.querySelector('.history .empty')!.textContent).toBe(
      'no commits yet — brush the scatter or click a bar',
    );
    expect(getViz().records()).toEqual([]);
  });
});

describe('scatter brush → commitDispatch (ok:true) → one user chip', () => {
  it('a real drag lands exactly one interval commit, chip shows user badge + kind + body + id', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(100, 300);

    const records = getViz().records();
    expect(records.length).toBe(1);
    expect(records[0]!.kind).toBe('interval');
    expect(records[0]!.field).toBe('price');
    expect(records[0]!.cause.requestedBy).toBe('user');

    const chip = document.querySelector('[data-chip]')!;
    expect(chip.querySelector('.badge')!.textContent).toBe('user');
    expect(chip.querySelector('.badge')!.getAttribute('data-actor')).toBe('user');
    expect(chip.querySelector('.k')!.textContent).toBe('interval');
    expect(chip.querySelector('.body')!.textContent).toMatch(/^price = \$\d+(\.\d+)?–\$\d+(\.\d+)?$/);
    expect(chip.querySelector('.cid')!.textContent).toBe(`#${records[0]!.id}`);
  });

  it('a click (no real drag) clears instead of committing — onBrushCommit(null) short-circuits before commitDispatch', async () => {
    await freshMount(NORMAL_CSV);
    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 200));
    svg.dispatchEvent(ptr('pointerup', 201)); // 1px — below the drag threshold
    await flush();
    expect(getViz().records()).toEqual([]);
    expect(document.querySelector('.history .empty')).not.toBeNull();
  });

  it('the live drag preview (onBrushMove) filters the BAR via a TRANSIENT clause — no log entry, self-exclusion keeps the scatter\'s own dots undimmed', async () => {
    await freshMount(NORMAL_CSV);
    expect(barCount('Casual')).toBe('2'); // d1 ($20) + d6 ($220)

    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 100)); // ≈ $39 — excludes both Casual rows
    svg.dispatchEvent(ptr('pointermove', 450)); // ≈ $200
    expect(getViz().records()).toEqual([]); // still nothing logged
    expect(barCount('Casual')).toBe('0'); // the bar reflects the live, unlogged preview
    // the scatter's OWN dots stay undimmed (self-exclusion) — it is a clause on itself
    expect(document.querySelectorAll('svg.scatter circle.dot.dim').length).toBe(0);

    svg.dispatchEvent(ptr('pointerup', 450));
    await vi.waitFor(() => {
      if (getViz().records().length === 0) throw new Error('not committed yet');
    });
    expect(barCount('Casual')).toBe('0'); // the committed filter keeps the same effect
  });
});

describe('render() — the bar-counts loop tolerates a category outside the fixed CATEGORIES list', () => {
  it('a row whose category is not one of the five declared bars still counts (the `counts.get(...) ?? 0` fallback)', async () => {
    // `counts` is pre-seeded with the five known CATEGORIES before this loop
    // runs, so `counts.get(r.category)` only ever misses (falls back to `0`)
    // for a category value OUTSIDE that fixed list — a real, off-spec CSV
    // row is the honest way to reach that fallback, not a synthetic call.
    const csvWithExtraCategory = `id,category,price,rating
d1,Casual,20,2
d2,Vintage,80,3
`;
    await freshMount(csvWithExtraCategory);
    // No throw, and the five real bars still render normally around the
    // untracked "Vintage" row (BarChart itself only ever draws its own cats).
    expect(document.querySelectorAll('svg.bar rect.barrect').length).toBe(5);
    expect(barCount('Casual')).toBe('1');
  });
});

describe('buildChip — the chip title is the commit\'s own intent', () => {
  it('a chip wears the intent of the commit it stands for', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200);

    // The record is REAL session state read through the app's own handle. It
    // is also deeply frozen (src/log/log.ts): the cause cannot be edited after
    // the fact, which is why this test reads it instead of rewriting it.
    const rec = getViz().records()[0]!;
    expect(Object.isFrozen(rec.cause)).toBe(true);
    expect(rec.cause.intent).toBeTruthy();
    expect((document.querySelector('[data-chip]') as HTMLElement).title).toBe(rec.cause.intent);
  });
});

describe('bar click → commitDispatch → one user chip; bar.highlight reflects the active category', () => {
  it('clicking a bar lands a point/select commit and outlines that bar', async () => {
    await freshMount(NORMAL_CSV);
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[1]!.dispatchEvent(new Event('click', { bubbles: true })); // 'Formal'
    await vi.waitFor(() => {
      if (getViz().records().length === 0) throw new Error('not committed yet');
    });
    const records = getViz().records();
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({ kind: 'point', field: 'category', value: 'Formal' });
    expect(document.querySelectorAll('svg.bar rect.selected').length).toBe(1);

    const chip = document.querySelector('[data-chip]')!;
    expect(chip.querySelector('.body')!.textContent).toBe('category = Formal');
  });
});

describe('commitDispatch (ok:false) — the empty dataset gives a real needs-column rejection', () => {
  it('a brush against zero columns lands NO commit and still re-renders honestly (the `else render()` arm)', async () => {
    await freshMount(EMPTY_CSV);
    const svg = scatterEl();
    stageForBrush(svg);
    svg.dispatchEvent(ptr('pointerdown', 100));
    svg.dispatchEvent(ptr('pointermove', 300));
    svg.dispatchEvent(ptr('pointerup', 300));
    await flush();
    expect(getViz().records()).toEqual([]);
    expect(document.querySelector('.history .empty')).not.toBeNull();
  });

  it('a bar click against zero columns also lands no commit', async () => {
    await freshMount(EMPTY_CSV);
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[0]!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    expect(getViz().records()).toEqual([]);
  });

  it('"Simulate agent brush" against zero columns resolves to no commit (applyRecord\'s `if (!record) return`)', async () => {
    await freshMount(EMPTY_CSV);
    // Drive it through the REAL DOM button (not the `window.__viz` shortcut)
    // so the toolbar's own `() => void simulateAgentBrush()` click handler
    // is exercised too, not just the function it wraps.
    document.querySelector<HTMLButtonElement>('[data-action="agent"]')!.click();
    await flush();
    expect(getViz().records()).toEqual([]);
    expect(document.querySelectorAll('[data-actor="agent"]').length).toBe(0);
  });
});

describe('"Simulate agent brush" — the REAL Mode-B viz.dispatch tool surface', () => {
  it('lands an agent-badged interval commit distinct from the user chips', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200); // one user commit first
    document.querySelector<HTMLButtonElement>('[data-action="agent"]')!.click();
    await vi.waitFor(() => {
      if (getViz().records().length < 2) throw new Error('waiting for the agent commit');
    });
    const records = getViz().records();
    expect(records.length).toBe(2);
    expect(records[1]!.cause.requestedBy).toBe('agent');
    expect(document.querySelectorAll('[data-actor="agent"]').length).toBe(1);
  });
});

describe('renderChips — the fork badge (⑂) appears only when a parent has >1 child', () => {
  it('"Fork here" on a selected chip appends a real sibling commit, and BOTH siblings show the fork marker (the root itself never can — its `parent` is null)', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200); // commit #1 (root, parent null)
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[0]!.dispatchEvent(new Event('click', { bubbles: true })); // commit #2, parent = commit #1
    await vi.waitFor(() => {
      if (getViz().records().length < 2) throw new Error('waiting for both commits');
    });

    // select commit #2 (its `parent` is commit #1's id — non-null) so the
    // fork sibling shares a non-null parent too. `isFork` requires
    // `rec.parent !== null`, so forking straight off the root (parent: null)
    // could never set it on either side — this is the branch that CAN.
    const chips = [...document.querySelectorAll('[data-chip]')];
    chips[1]!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document.querySelectorAll('[data-chip].sel').length).toBe(1);

    document.querySelector<HTMLButtonElement>('[data-action="fork"]')!.click();

    const records = getViz().records();
    expect(records.length).toBe(3);
    // the fork lands a SIBLING of the selected commit — same PARENT, not a child of it.
    expect(records[2]!.parent).toBe(records[1]!.parent);
    expect(records[2]!.parent).toBe(records[0]!.id);
    expect(records[2]!.id.startsWith('fork')).toBe(true);

    const forkMarks = document.querySelectorAll('[data-chip] .fork');
    expect(forkMarks.length).toBe(2); // commit #2 and the new fork — NOT the root
  });

  it('"Fork here" with nothing selected is a no-op', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200);
    document.querySelector<HTMLButtonElement>('[data-action="fork"]')!.click();
    expect(getViz().records().length).toBe(1); // unchanged
  });

  it('a selected commit can never leave the log — the app\'s own handle cannot shrink the trace', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200);
    document.querySelector('[data-chip]')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document.querySelectorAll('[data-chip].sel').length).toBe(1);

    // This is the precondition `forkHere`'s `if (!rec) return;` guards against,
    // and it is now unreachable BY CONSTRUCTION. `window.__viz.records()` is the
    // real, app-exposed handle on the session's log; it hands back a frozen
    // snapshot, so the trace cannot be emptied, truncated or spliced through it.
    // (Before the append-only fix this line read `records().length = 0` and the
    // log really did empty.)
    const trace = getViz().records();
    expect(Object.isFrozen(trace)).toBe(true);
    expect(() => {
      (trace as VizRecord[]).length = 0;
    }).toThrow(TypeError);
    expect(() => (trace as VizRecord[]).push(trace[0]!)).toThrow(TypeError);

    // …so "Fork here" still finds its commit and lands the sibling.
    document.querySelector<HTMLButtonElement>('[data-action="fork"]')!.click();
    expect(getViz().records().length).toBe(2);
  });
});

describe('"Replay session"', () => {
  it('with zero commits is a no-op', async () => {
    await freshMount(NORMAL_CSV);
    document.querySelector<HTMLButtonElement>('[data-action="replay"]')!.click();
    expect(document.querySelector('.history .empty')).not.toBeNull();
  });

  it('with commits rebuilds a fresh, chip-identical sequence, each re-marked `replayed`, and deselects', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(60, 200);
    const rects = [...document.querySelectorAll('svg.bar rect.barrect')];
    rects[0]!.dispatchEvent(new Event('click', { bubbles: true }));
    await vi.waitFor(() => {
      if (getViz().records().length < 2) throw new Error('waiting for both commits');
    });

    document.querySelector('[data-chip]')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document.querySelectorAll('[data-chip].sel').length).toBe(1);

    getViz().replaySession();
    // animateReplay steps in one chip at a time (90ms apart) — wait for the full sequence.
    await vi.waitFor(
      () => {
        if (document.querySelectorAll('[data-replayed="1"]').length < 2) throw new Error('still animating');
      },
      { timeout: 2000, interval: 20 },
    );
    expect(document.querySelectorAll('[data-chip]').length).toBe(2);
    // selection was cleared by replay (no chip carries .sel anymore)
    expect(document.querySelectorAll('[data-chip].sel').length).toBe(0);
  });
});

describe('"Reset view"', () => {
  it('clears the active (already-committed) clause transiently — bar counts return to full, but the log is untouched', async () => {
    await freshMount(NORMAL_CSV);
    await dragAndWaitForCommit(100, 450); // excludes both Casual rows ($20, $220)
    expect(barCount('Casual')).toBe('0');

    document.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    expect(barCount('Casual')).toBe('2'); // full count again
    expect(getViz().records().length).toBe(1); // the commit itself is still in the log
  });

  it('clicking reset with no active clauses is a harmless no-op (the loop body simply never runs)', async () => {
    await freshMount(NORMAL_CSV);
    document.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    expect(getViz().records()).toEqual([]);
  });
});
