/**
 * Shared browser helpers for both demo pages — DOM builders, the seeded-CSV
 * loader (reusing src/data's REAL csv parser), a category colour scale, and two
 * hand-rolled SVG charts (no chart-library dep):
 *   - Scatter: price (x) vs rating (y), coloured by category, with a horizontal
 *     price BRUSH that emits DATA-space intervals (R5 — never pixels) and an
 *     optional regression-line overlay (the analyst's geometry channel).
 *   - BarChart: count by category, click-to-select.
 *
 * Two-string discipline (SPEC): every piece of runtime/data text is written via
 * textContent / text nodes — never innerHTML. Static page chrome lives in the
 * server's HTML template; everything these charts draw from data is DOM-built.
 */

// The REAL landed CSV parser (src/data) — not duplicated here.
import { parseCSVTyped, type PredicateClause } from 'vizfootprint/data';
import type { ChartEmission } from 'vizfootprint/mosaic';
import type { CommitRecord } from 'vizfootprint/log';

const SVGNS = 'http://www.w3.org/2000/svg';

/** One demo row (dresses.csv). Extra keys (e.g. a materialized cluster_id) allowed. */
export interface DemoRow {
  readonly id: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  [k: string]: string | number;
}

/** The five categories, in a stable order, each with a light/dark-safe hue. */
export const CATEGORIES = ['Casual', 'Formal', 'Party', 'Work', 'Summer'] as const;
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_COLORS: Record<string, string> = {
  Casual: '#4c8dff',
  Formal: '#a86bff',
  Party: '#ff5c9d',
  Work: '#00b3a4',
  Summer: '#f5a623',
};
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#888';
}

// ── DOM builders (all text via textContent / text nodes) ─────────────────────

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string; title?: string; dataset?: Record<string, string> } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Replace all children of a node (clears then appends). */
export function replaceChildren(parent: Element, ...nodes: (Node | null)[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const n of nodes) if (n) parent.appendChild(n);
}

// ── Data loading (fetch the shipped seeded CSV, parse via src/data) ──────────

export async function loadRows(): Promise<DemoRow[]> {
  const res = await fetch('/data/dresses.csv');
  const text = await res.text();
  const parsed = parseCSVTyped(text); // src/data — sniffs price/rating -> number
  return parsed.rows.map((r) => ({
    id: String(r['id']),
    category: String(r['category']),
    price: Number(r['price']),
    rating: Number(r['rating']),
  }));
}

// ── The scatter chart (price × rating), with a horizontal price brush ────────

export interface Scale {
  (v: number): number;
  invert(px: number): number;
}
function linearScale(d0: number, d1: number, r0: number, r1: number): Scale {
  /* v8 ignore next -- `linearScale` is module-private with exactly two call sites (both inside
   * Scatter's constructor): the x-scale's domain is `[pMin-5, pMax+5]` and the y-scale's is the
   * fixed `[0.5, 5.5]` — both always have `d1-d0 >= 5` (the +-5 padding forbids a zero span even
   * when every row shares one price). The `|| 1` zero-guard cannot be reached via any DemoRow set. */
  const m = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * m) as Scale;
  f.invert = (px: number) => d0 + (px - r0) / m;
  return f;
}

export interface ScatterOptions {
  /** DATA-space field the horizontal brush emits an interval on (default 'price'). */
  readonly brushField?: string;
  /** Called on every pointer move during a brush (transient — DATA space, or null on clear). */
  onBrushMove?(interval: [number, number] | null): void;
  /** Called once on pointer-up (commit intent). */
  onBrushCommit?(interval: [number, number] | null): void;
}

export class Scatter {
  readonly root: SVGSVGElement;
  private readonly width = 520;
  private readonly height = 340;
  private readonly pad = { l: 48, r: 16, t: 16, b: 40 };
  private readonly x: Scale;
  private readonly y: Scale;
  private readonly ptLayer: SVGGElement;
  private readonly overlay: SVGGElement;
  private readonly brushRect: SVGRectElement;
  private readonly dots = new Map<string, SVGCircleElement>();
  private readonly brushField: string;

  constructor(
    private readonly rows: DemoRow[],
    private readonly opts: ScatterOptions = {},
  ) {
    this.brushField = opts.brushField ?? 'price';
    const prices = rows.map((r) => r.price);
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    this.x = linearScale(pMin - 5, pMax + 5, this.pad.l, this.width - this.pad.r);
    this.y = linearScale(0.5, 5.5, this.height - this.pad.b, this.pad.t);

    this.root = svg('svg', {
      viewBox: `0 0 ${this.width} ${this.height}`,
      class: 'chart scatter',
      role: 'img',
    }) as SVGSVGElement;

    this.drawAxes(pMin, pMax);

    this.overlay = svg('g', {}) as SVGGElement;
    this.ptLayer = svg('g', {}) as SVGGElement;
    this.brushRect = svg('rect', {
      class: 'brush',
      x: 0,
      y: this.pad.t,
      width: 0,
      height: this.height - this.pad.t - this.pad.b,
      rx: 2,
    }) as SVGRectElement;
    this.brushRect.style.display = 'none';
    this.root.append(this.overlay, this.ptLayer, this.brushRect);

    for (const r of rows) {
      const c = svg('circle', {
        cx: this.x(r.price),
        cy: this.y(r.rating),
        r: 4,
        fill: categoryColor(r.category),
        class: 'dot',
      }) as SVGCircleElement;
      const label = `${r.id} · ${r.category} · $${r.price} · ${r.rating}★`;
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = label;
      c.appendChild(t);
      this.dots.set(r.id, c);
      this.ptLayer.appendChild(c);
    }

    this.installBrush();
  }

  private drawAxes(pMin: number, pMax: number): void {
    // axis frame
    this.root.appendChild(
      svg('line', {
        x1: this.pad.l,
        y1: this.height - this.pad.b,
        x2: this.width - this.pad.r,
        y2: this.height - this.pad.b,
        class: 'axis',
      }),
    );
    this.root.appendChild(
      svg('line', { x1: this.pad.l, y1: this.pad.t, x2: this.pad.l, y2: this.height - this.pad.b, class: 'axis' }),
    );
    // x ticks (price)
    for (let k = 0; k <= 4; k++) {
      const v = pMin + ((pMax - pMin) * k) / 4;
      const px = this.x(v);
      this.root.appendChild(svg('line', { x1: px, y1: this.height - this.pad.b, x2: px, y2: this.height - this.pad.b + 4, class: 'axis' }));
      const lbl = svg('text', { x: px, y: this.height - this.pad.b + 16, class: 'tick', 'text-anchor': 'middle' });
      lbl.textContent = `$${Math.round(v)}`;
      this.root.appendChild(lbl);
    }
    // y ticks (rating)
    for (let v = 1; v <= 5; v++) {
      const py = this.y(v);
      this.root.appendChild(svg('line', { x1: this.pad.l - 4, y1: py, x2: this.pad.l, y2: py, class: 'axis' }));
      const lbl = svg('text', { x: this.pad.l - 8, y: py + 3, class: 'tick', 'text-anchor': 'end' });
      lbl.textContent = `${v}★`;
      this.root.appendChild(lbl);
    }
    const xl = svg('text', { x: (this.pad.l + this.width - this.pad.r) / 2, y: this.height - 4, class: 'axis-label', 'text-anchor': 'middle' });
    xl.textContent = 'price ($) — drag to brush';
    this.root.appendChild(xl);
  }

  private installBrush(): void {
    let x0 = 0;
    let dragging = false;
    const clamp = (px: number): number => Math.max(this.pad.l, Math.min(this.width - this.pad.r, px));
    const pxFromEvent = (ev: PointerEvent): number => {
      const rect = this.root.getBoundingClientRect();
      const scale = this.width / rect.width;
      return clamp((ev.clientX - rect.left) * scale);
    };
    const toInterval = (a: number, b: number): [number, number] => {
      const lo = this.x.invert(Math.min(a, b));
      const hi = this.x.invert(Math.max(a, b));
      return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
    };
    this.root.addEventListener('pointerdown', (ev) => {
      dragging = true;
      x0 = pxFromEvent(ev);
      this.root.setPointerCapture(ev.pointerId);
      this.brushRect.style.display = '';
    });
    this.root.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const x1 = pxFromEvent(ev);
      const left = Math.min(x0, x1);
      this.brushRect.setAttribute('x', String(left));
      this.brushRect.setAttribute('width', String(Math.abs(x1 - x0)));
      this.opts.onBrushMove?.(toInterval(x0, x1));
    });
    const finish = (ev: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      const x1 = pxFromEvent(ev);
      if (Math.abs(x1 - x0) < 4) {
        // a click, not a drag → clear the brush
        this.brushRect.style.display = 'none';
        this.opts.onBrushCommit?.(null);
      } else {
        this.opts.onBrushCommit?.(toInterval(x0, x1));
      }
    };
    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', finish);
  }

  /** Build the ChartEmission for the current brush field (R5: DATA space). */
  static brushEmission(field: string, interval: [number, number] | null): ChartEmission {
    return { rawValue: interval, encoding: { kind: 'interval', field } };
  }

  get field(): string {
    return this.brushField;
  }

  /** Dim points that do NOT satisfy `keep` (self-exclusion aware — the caller decides). */
  setHighlight(keep: (row: DemoRow) => boolean): void {
    for (const r of this.rows) {
      const dot = this.dots.get(r.id);
      if (!dot) continue;
      dot.classList.toggle('dim', !keep(r));
    }
  }

  /** Draw (or clear) a regression line overlay from an OLS geometry result. */
  setRegressionLine(geom: { slope: number; intercept: number; domain: readonly [number, number] } | null): void {
    replaceChildren(this.overlay);
    if (!geom) return;
    const [xa, xb] = geom.domain;
    const line = svg('line', {
      x1: this.x(xa),
      y1: this.y(geom.slope * xa + geom.intercept),
      x2: this.x(xb),
      y2: this.y(geom.slope * xb + geom.intercept),
      class: 'regline',
    });
    this.overlay.appendChild(line);
  }
}

// ── The bar chart (count by category), click-to-select ───────────────────────

export interface BarOptions {
  onBarClick?(category: string): void;
}

export class BarChart {
  readonly root: SVGSVGElement;
  private readonly width = 360;
  private readonly height = 340;
  private readonly pad = { l: 36, r: 12, t: 16, b: 46 };
  private readonly bars = new Map<string, SVGRectElement>();
  private readonly labels = new Map<string, SVGTextElement>();
  private readonly cats: readonly string[];

  constructor(cats: readonly string[], private readonly opts: BarOptions = {}) {
    this.cats = cats;
    this.root = svg('svg', { viewBox: `0 0 ${this.width} ${this.height}`, class: 'chart bar', role: 'img' }) as SVGSVGElement;
    this.root.appendChild(
      svg('line', { x1: this.pad.l, y1: this.height - this.pad.b, x2: this.width - this.pad.r, y2: this.height - this.pad.b, class: 'axis' }),
    );
    const band = (this.width - this.pad.l - this.pad.r) / cats.length;
    cats.forEach((cat, i) => {
      const cx = this.pad.l + band * i;
      const rect = svg('rect', {
        x: cx + band * 0.12,
        y: this.height - this.pad.b,
        width: band * 0.76,
        height: 0,
        fill: categoryColor(cat),
        class: 'barrect',
        role: 'button',
      }) as SVGRectElement;
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => this.opts.onBarClick?.(cat));
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = `click to select ${cat}`;
      rect.appendChild(t);
      this.bars.set(cat, rect);
      this.root.appendChild(rect);

      const lbl = svg('text', { x: cx + band / 2, y: this.height - this.pad.b + 16, class: 'tick', 'text-anchor': 'middle' });
      lbl.textContent = cat;
      this.root.appendChild(lbl);

      const val = svg('text', { x: cx + band / 2, y: this.height - this.pad.b - 4, class: 'barval', 'text-anchor': 'middle' }) as SVGTextElement;
      val.textContent = '0';
      this.labels.set(cat, val);
      this.root.appendChild(val);
    });
    const xl = svg('text', { x: this.width / 2, y: this.height - 6, class: 'axis-label', 'text-anchor': 'middle' });
    xl.textContent = 'category — click to select';
    this.root.appendChild(xl);
  }

  /** Update bar heights from a category→count map (self-exclusion applied upstream). */
  setCounts(counts: Map<string, number>): void {
    const max = Math.max(1, ...this.cats.map((c) => counts.get(c) ?? 0));
    const plot = this.height - this.pad.t - this.pad.b;
    for (const cat of this.cats) {
      const n = counts.get(cat) ?? 0;
      const h = (n / max) * plot;
      const rect = this.bars.get(cat);
      const lbl = this.labels.get(cat);
      if (rect) {
        rect.setAttribute('y', String(this.height - this.pad.b - h));
        rect.setAttribute('height', String(h));
      }
      if (lbl) {
        lbl.setAttribute('y', String(this.height - this.pad.b - h - 4));
        lbl.textContent = String(n);
      }
    }
  }

  /** Outline the actively-selected category (null clears). */
  highlight(category: string | null): void {
    for (const [cat, rect] of this.bars) rect.classList.toggle('selected', cat === category);
  }
}

// ── misc formatting (data text still set via textContent by callers) ─────────

export function fmtInterval(iv: [number, number] | null): string {
  return iv ? `$${iv[0]}–$${iv[1]}` : '(cleared)';
}

// ── shared L5-session wiring helpers (both demo pages drive `session.dispatch`) ──

/** A clickable toolbar button (all label text via textContent). */
export function actionButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'btn', text: label, dataset: { action: id } });
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Recover the in-JS `PredicateClause` a landed `CommitRecord` represents — the
 * same recipe `src/log`'s `replayLog` uses to rebuild a clause, just kept as a
 * `{kind,field,value}` triple for `matchesClause` rather than a live Mosaic
 * clause. `null` means "this commit clears its field" (an interval commit with
 * `value: null`).
 */
export function specFromRecord(rec: CommitRecord): PredicateClause | null {
  if (rec.kind === 'interval') {
    const v = rec.value as [number, number] | null;
    return v === null ? null : { kind: 'interval', field: rec.field, value: v };
  }
  return { kind: 'point', field: rec.field, value: rec.value };
}
