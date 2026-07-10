// @vitest-environment jsdom
/**
 * Coverage packet COV-demo — closes demo/src/common.ts (the shared browser
 * DOM builders + the two hand-rolled SVG charts) from 0% to full statement/
 * branch/function/line coverage. jsdom has no real layout engine and does not
 * implement PointerEvent/setPointerCapture at all (verified empirically: both
 * throw "not a constructor"/"not a function"), so this file:
 *   - dispatches `MouseEvent`s typed as 'pointerdown'/'pointermove'/'pointerup'/
 *     'pointercancel' (addEventListener matches by TYPE STRING, not event
 *     class — this is a legitimate way to drive the exact same handlers a
 *     real browser would, not a mock of behavior);
 *   - stubs `getBoundingClientRect()` on the chart's own SVG root to a fixed,
 *     1:1 rect matching its viewBox pixel space, and stubs `setPointerCapture`
 *     as a no-op — both real methods jsdom simply doesn't implement, not
 *     application behavior being faked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  el,
  replaceChildren,
  categoryColor,
  CATEGORIES,
  loadRows,
  Scatter,
  BarChart,
  fmtInterval,
  actionButton,
  specFromRecord,
  type DemoRow,
} from './common.js';
import type { CommitRecord } from '../../src/log/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ── categoryColor ────────────────────────────────────────────────────────────

describe('categoryColor', () => {
  it('returns the fixed hue for every declared category', () => {
    expect(categoryColor('Casual')).toBe('#4c8dff');
    expect(categoryColor('Formal')).toBe('#a86bff');
    expect(categoryColor('Party')).toBe('#ff5c9d');
    expect(categoryColor('Work')).toBe('#00b3a4');
    expect(categoryColor('Summer')).toBe('#f5a623');
  });

  it('falls back to grey for an unknown category', () => {
    expect(categoryColor('Nonexistent')).toBe('#888');
  });
});

// ── el() ──────────────────────────────────────────────────────────────────────

describe('el()', () => {
  it('with no opts and no children produces a bare element (every default branch)', () => {
    const node = el('div');
    expect(node.tagName).toBe('DIV');
    expect(node.className).toBe('');
    expect(node.textContent).toBe('');
    expect(node.title).toBe('');
    expect(node.children.length).toBe(0);
  });

  it('sets class when opts.class is truthy, skips it when falsy/absent', () => {
    expect(el('span', { class: 'foo' }).className).toBe('foo');
    expect(el('span', {}).className).toBe('');
  });

  it('sets textContent whenever opts.text !== undefined, including an explicit empty string', () => {
    expect(el('span', { text: 'hello' }).textContent).toBe('hello');
    expect(el('span', { text: '' }).textContent).toBe('');
    expect(el('span', {}).textContent).toBe('');
  });

  it('sets title when truthy, skips it when falsy/absent', () => {
    expect(el('span', { title: 'tip' }).title).toBe('tip');
    expect(el('span', { title: '' }).title).toBe('');
    expect(el('span', {}).title).toBe('');
  });

  it('sets every dataset entry when opts.dataset is given (loop body exercised for >1 key)', () => {
    const node = el('div', { dataset: { foo: '1', bar: 'two' } });
    expect(node.dataset['foo']).toBe('1');
    expect(node.dataset['bar']).toBe('two');
  });

  it('appends only non-null children, preserving order', () => {
    const a = document.createElement('i');
    const b = document.createElement('b');
    const node = el('div', {}, [a, null, b, null]);
    expect([...node.childNodes]).toEqual([a, b]);
  });
});

// ── replaceChildren ───────────────────────────────────────────────────────────

describe('replaceChildren', () => {
  it('clears existing children then appends only the non-null new ones', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    parent.appendChild(document.createElement('span'));
    expect(parent.childNodes.length).toBe(2);

    const a = document.createElement('i');
    const b = document.createElement('b');
    replaceChildren(parent, a, null, b);
    expect([...parent.childNodes]).toEqual([a, b]);
  });

  it('with zero nodes just clears (the loop body never runs)', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    replaceChildren(parent);
    expect(parent.childNodes.length).toBe(0);
  });
});

// ── loadRows ──────────────────────────────────────────────────────────────────

describe('loadRows', () => {
  it('fetches /data/dresses.csv and maps each row through parseCSVTyped into a typed DemoRow', async () => {
    const csv = 'id,category,price,rating\nd1,Casual,42.5,4\nd2,Formal,101,3.5\n';
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/data/dresses.csv');
      return { text: async () => csv } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await loadRows();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      { id: 'd1', category: 'Casual', price: 42.5, rating: 4 },
      { id: 'd2', category: 'Formal', price: 101, rating: 3.5 },
    ]);
  });
});

// ── fmtInterval ───────────────────────────────────────────────────────────────

describe('fmtInterval', () => {
  it('formats a real interval as a price range', () => {
    expect(fmtInterval([10, 20])).toBe('$10–$20');
  });
  it('formats null as "(cleared)"', () => {
    expect(fmtInterval(null)).toBe('(cleared)');
  });
});

// ── actionButton ──────────────────────────────────────────────────────────────

describe('actionButton', () => {
  it('builds a labeled button carrying data-action and firing onClick', () => {
    const onClick = vi.fn();
    const btn = actionButton('replay', 'Replay session', onClick);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Replay session');
    expect(btn.dataset['action']).toBe('replay');
    expect(btn.className).toBe('btn');
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ── specFromRecord ────────────────────────────────────────────────────────────

function baseRecord(over: Partial<CommitRecord>): CommitRecord {
  return {
    id: 'c1',
    parent: null,
    viewId: 'scatter',
    actorMeta: { actor: 'user' },
    kind: 'interval',
    field: 'price',
    value: null,
    clientViewIds: ['scatter'],
    predicateSQL: '',
    cause: { requestedBy: 'user', computedBy: 'user' },
    ts: 0,
    ...over,
  };
}

describe('specFromRecord', () => {
  it('an interval record with a non-null value becomes an interval PredicateClause', () => {
    const rec = baseRecord({ kind: 'interval', field: 'price', value: [10, 20] });
    expect(specFromRecord(rec)).toEqual({ kind: 'interval', field: 'price', value: [10, 20] });
  });

  it('an interval record with value:null (a clear) returns null', () => {
    const rec = baseRecord({ kind: 'interval', field: 'price', value: null });
    expect(specFromRecord(rec)).toBeNull();
  });

  it('a point record becomes a point PredicateClause', () => {
    const rec = baseRecord({ kind: 'point', field: 'category', value: 'Formal' });
    expect(specFromRecord(rec)).toEqual({ kind: 'point', field: 'category', value: 'Formal' });
  });
});

// ── Scatter ───────────────────────────────────────────────────────────────────

const ROWS: DemoRow[] = [
  { id: 'r1', category: 'Casual', price: 20, rating: 2 },
  { id: 'r2', category: 'Formal', price: 100, rating: 4 },
  { id: 'r3', category: 'Party', price: 180, rating: 5 },
];

/** Stub the chart's SVG root to a 1:1 pixel rect and a no-op pointer-capture,
 * so brush math is deterministic under jsdom (which lays out nothing and does
 * not implement setPointerCapture at all). */
function stageForBrush(root: SVGSVGElement, width: number, height: number): void {
  (root as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (root as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
}

function ptr(type: string, clientX: number): Event {
  const ev = new MouseEvent(type, { clientX, clientY: 10, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  return ev;
}

describe('Scatter', () => {
  it('constructs one dot per row at the scaled price/rating position, with a title tooltip', () => {
    const scatter = new Scatter(ROWS);
    document.body.appendChild(scatter.root);
    const circles = scatter.root.querySelectorAll('circle.dot');
    expect(circles.length).toBe(3);
    const first = circles[0]!;
    expect(first.querySelector('title')!.textContent).toBe('r1 · Casual · $20 · 2★');
    expect(first.getAttribute('fill')).toBe(categoryColor('Casual'));
  });

  it('draws axis ticks (5 x-ticks, 5 y-ticks) and the axis label', () => {
    const scatter = new Scatter(ROWS);
    const labels = [...scatter.root.querySelectorAll('text.tick')].map((t) => t.textContent);
    // 5 x price ticks ($..) + 5 y rating ticks (N★)
    expect(labels.filter((t) => t?.startsWith('$')).length).toBe(5);
    expect(labels.filter((t) => t?.endsWith('★')).length).toBe(5);
    expect(scatter.root.querySelector('text.axis-label')!.textContent).toBe('price ($) — drag to brush');
  });

  it('field getter defaults to "price" and reflects a custom brushField', () => {
    expect(new Scatter(ROWS).field).toBe('price');
    expect(new Scatter(ROWS, { brushField: 'rating' }).field).toBe('rating');
  });

  it('static brushEmission builds a ChartEmission for the given field/interval', () => {
    expect(Scatter.brushEmission('price', [10, 20])).toEqual({
      rawValue: [10, 20],
      encoding: { kind: 'interval', field: 'price' },
    });
    expect(Scatter.brushEmission('price', null)).toEqual({
      rawValue: null,
      encoding: { kind: 'interval', field: 'price' },
    });
  });

  it('a real drag (>=4px) reports a live onBrushMove interval, shows the brush rect, then commits on pointerup', () => {
    const moves: Array<[number, number] | null> = [];
    const commits: Array<[number, number] | null> = [];
    const scatter = new Scatter(ROWS, {
      onBrushMove: (iv) => moves.push(iv),
      onBrushCommit: (iv) => commits.push(iv),
    });
    document.body.appendChild(scatter.root);
    stageForBrush(scatter.root, 520, 340);

    scatter.root.dispatchEvent(ptr('pointerdown', 100));
    expect(scatter.root.querySelector<SVGRectElement>('rect.brush')!.style.display).toBe('');

    scatter.root.dispatchEvent(ptr('pointermove', 300));
    expect(moves.length).toBe(1);
    expect(moves[0]).not.toBeNull();
    const [lo, hi] = moves[0]!;
    expect(lo).toBeLessThan(hi);
    const brushRect = scatter.root.querySelector('rect.brush')!;
    expect(brushRect.getAttribute('x')).toBe('100');
    expect(brushRect.getAttribute('width')).toBe('200');

    scatter.root.dispatchEvent(ptr('pointerup', 300));
    expect(commits.length).toBe(1);
    expect(commits[0]).toEqual(moves[0]);
  });

  it('a small drag (<4px) is treated as a click: commits null and hides the brush rect', () => {
    const commits: Array<[number, number] | null> = [];
    const scatter = new Scatter(ROWS, { onBrushCommit: (iv) => commits.push(iv) });
    document.body.appendChild(scatter.root);
    stageForBrush(scatter.root, 520, 340);

    scatter.root.dispatchEvent(ptr('pointerdown', 200));
    scatter.root.dispatchEvent(ptr('pointerup', 201)); // 1px — below the 4px drag threshold
    expect(commits).toEqual([null]);
    expect((scatter.root.querySelector('rect.brush') as SVGRectElement).style.display).toBe('none');
  });

  it('pointercancel also finishes the drag (same commit path as pointerup)', () => {
    const commits: Array<[number, number] | null> = [];
    const scatter = new Scatter(ROWS, { onBrushCommit: (iv) => commits.push(iv) });
    document.body.appendChild(scatter.root);
    stageForBrush(scatter.root, 520, 340);

    scatter.root.dispatchEvent(ptr('pointerdown', 60));
    scatter.root.dispatchEvent(ptr('pointercancel', 260));
    expect(commits.length).toBe(1);
    expect(commits[0]).not.toBeNull();
  });

  it('pointermove/pointerup/pointercancel before any pointerdown are no-ops (the !dragging guards)', () => {
    const moves: unknown[] = [];
    const commits: unknown[] = [];
    const scatter = new Scatter(ROWS, {
      onBrushMove: (iv) => moves.push(iv),
      onBrushCommit: (iv) => commits.push(iv),
    });
    document.body.appendChild(scatter.root);
    stageForBrush(scatter.root, 520, 340);

    scatter.root.dispatchEvent(ptr('pointermove', 300));
    scatter.root.dispatchEvent(ptr('pointerup', 300));
    scatter.root.dispatchEvent(ptr('pointercancel', 300));
    expect(moves).toEqual([]);
    expect(commits).toEqual([]);
  });

  it('the brush clamps to the plot area when dragged past either edge', () => {
    const commits: Array<[number, number] | null> = [];
    const scatter = new Scatter(ROWS, { onBrushCommit: (iv) => commits.push(iv) });
    document.body.appendChild(scatter.root);
    stageForBrush(scatter.root, 520, 340);

    scatter.root.dispatchEvent(ptr('pointerdown', -500)); // clamps to pad.l = 48
    scatter.root.dispatchEvent(ptr('pointerup', 5000)); // clamps to width - pad.r = 504
    expect(commits.length).toBe(1);
    const [lo, hi] = commits[0]!;
    expect(lo).toBeLessThan(hi);
  });

  it('setHighlight dims dots that fail `keep`, and skips rows whose dot is missing (post-construction row mutation)', () => {
    const liveRows: DemoRow[] = [...ROWS];
    const scatter = new Scatter(liveRows);
    document.body.appendChild(scatter.root);

    scatter.setHighlight((r) => r.category === 'Casual');
    const dotFor = (id: string) => scatter.root.querySelector(`circle[fill]`) && [...scatter.root.querySelectorAll('circle.dot')].find((c) => c.querySelector('title')!.textContent!.startsWith(id + ' '));
    expect(dotFor('r1')!.classList.contains('dim')).toBe(false);
    expect(dotFor('r2')!.classList.contains('dim')).toBe(true);
    expect(dotFor('r3')!.classList.contains('dim')).toBe(true);

    // The `rows` array is the SAME reference the constructor captured (a
    // constructor-parameter property, never copied) — pushing a new row onto
    // it after construction is a real, live mutation, not a stub. A row with
    // an id `setHighlight` never built a dot for exercises the `if (!dot)
    // continue` guard for real.
    liveRows.push({ id: 'ghost', category: 'Work', price: 50, rating: 3 });
    expect(() => scatter.setHighlight(() => true)).not.toThrow();
  });

  it('setRegressionLine draws an overlay line from slope/intercept/domain, and clears it when passed null', () => {
    const scatter = new Scatter(ROWS);
    document.body.appendChild(scatter.root);
    scatter.setRegressionLine({ slope: 0.01, intercept: 1, domain: [20, 180] });
    let line = scatter.root.querySelector('line.regline');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('x1')).not.toBe(line!.getAttribute('x2'));

    scatter.setRegressionLine(null);
    line = scatter.root.querySelector('line.regline');
    expect(line).toBeNull();

    // replaceChildren clears the PREVIOUS overlay line before drawing a new one
    scatter.setRegressionLine({ slope: 0.02, intercept: 2, domain: [20, 180] });
    scatter.setRegressionLine({ slope: -0.02, intercept: 5, domain: [20, 180] });
    expect(scatter.root.querySelectorAll('line.regline').length).toBe(1);
  });
});

// ── BarChart ──────────────────────────────────────────────────────────────────

describe('BarChart', () => {
  it('renders one bar + label + zeroed value per category, and the axis label', () => {
    const bar = new BarChart(CATEGORIES);
    expect(bar.root.querySelectorAll('rect.barrect').length).toBe(CATEGORIES.length);
    const vals = [...bar.root.querySelectorAll('text.barval')].map((t) => t.textContent);
    expect(vals).toEqual(CATEGORIES.map(() => '0'));
    expect(bar.root.querySelector('text.axis-label')!.textContent).toBe('category — click to select');
  });

  it('clicking a bar rect fires onBarClick with that category', () => {
    const onBarClick = vi.fn();
    const bar = new BarChart(CATEGORIES, { onBarClick });
    document.body.appendChild(bar.root);
    const rects = [...bar.root.querySelectorAll('rect.barrect')];
    rects[2]!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBarClick).toHaveBeenCalledWith(CATEGORIES[2]);
  });

  it('setCounts scales bar heights against the max (>=1 floor) and fills in missing categories as 0', () => {
    const bar = new BarChart(CATEGORIES);
    // Deliberately omit some categories from the map to exercise `counts.get(c) ?? 0`.
    const counts = new Map<string, number>([['Casual', 4], ['Formal', 8]]);
    bar.setCounts(counts);
    const vals = new Map(
      CATEGORIES.map((c, i) => [c, [...bar.root.querySelectorAll('text.barval')][i]!.textContent]),
    );
    expect(vals.get('Casual')).toBe('4');
    expect(vals.get('Formal')).toBe('8');
    expect(vals.get('Party')).toBe('0');
    expect(vals.get('Work')).toBe('0');
    expect(vals.get('Summer')).toBe('0');
  });

  it('setCounts with an all-zero map still forces max=1 (no NaN heights)', () => {
    const bar = new BarChart(CATEGORIES);
    bar.setCounts(new Map());
    for (const rect of bar.root.querySelectorAll('rect.barrect')) {
      expect(rect.getAttribute('height')).toBe('0');
      expect(Number.isNaN(Number(rect.getAttribute('height')))).toBe(false);
    }
  });

  it('setCounts skips a category with no rendered bar/label (post-construction cats mutation)', () => {
    // `this.cats = cats` is a direct assignment of the constructor argument
    // (never cloned) — same live-reference trick as the Scatter row mutation
    // above. `this.bars`/`this.labels` are built ONCE at construction time
    // from the categories that existed then; pushing a new category onto the
    // SAME array afterward makes `setCounts`'s `for (const cat of this.cats)`
    // loop visit a category neither map has an entry for, driving the real
    // `if (rect)` / `if (lbl)` guards to their false arm.
    const liveCats: string[] = [...CATEGORIES];
    const bar = new BarChart(liveCats);
    liveCats.push('Ghost');
    expect(() => bar.setCounts(new Map([['Ghost', 9]]))).not.toThrow();
    // the five real bars still update normally around the untracked ghost entry
    bar.setCounts(new Map([['Casual', 3]]));
    expect(bar.root.querySelectorAll('rect.barrect').length).toBe(CATEGORIES.length);
  });

  it('highlight outlines exactly the selected category, and null clears every outline', () => {
    const bar = new BarChart(CATEGORIES);
    bar.highlight('Party');
    const selected = [...bar.root.querySelectorAll('rect.barrect')].filter((r) => r.classList.contains('selected'));
    expect(selected.length).toBe(1);

    bar.highlight(null);
    expect([...bar.root.querySelectorAll('rect.barrect')].some((r) => r.classList.contains('selected'))).toBe(false);
  });
});
