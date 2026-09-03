/**
 * Surface-bench measurement program — runs under plain Node (bundled by
 * run.mjs), prints one JSON document on stdout.
 *
 * WHAT THIS BENCH IS FOR: the cost of vizfootprint's agent surface has been
 * quoted from one-off measurements taken in a chat. This turns those numbers
 * into a command. Five measurements, at three shapes:
 *
 *   1 menu        — `JSON.stringify(tools())`, the fixed cost paid every turn,
 *                   plus the per-tool breakdown, plus a CHECK that the list is
 *                   byte-stable (the docstring claims it; a claim is not a fact).
 *   2 whats_here  — `JSON.stringify(await call('viz.whats_here'))`, per shape.
 *   3 composition — where those bytes go, by top-level key, by SERIALIZING each
 *                   subtree rather than guessing.
 *   4 churn       — serialize, do ONE ordinary act, serialize again: what
 *                   fraction of the answer is unchanged. The number that says
 *                   whether deltas or a rules-plus-exceptions restatement pay.
 *   5 floor       — the smallest subset that still supports a first correct act.
 *
 * UNITS. Every number here is a UTF-8 BYTE count (`Buffer.byteLength`, not
 * `String.length` — edge ids carry a `→`). Bytes are exact and need no network.
 * TOKENS are a different thing and this program never estimates them: no
 * divide-by-four, no third-party tokenizer. `--tokens` (SURFACE_TOKENS=1) adds
 * a pass that calls Anthropic's real token-counting endpoint when
 * `@anthropic-ai/sdk` is importable and a key is in the environment; otherwise
 * it says so in one line and the bench carries on with bytes.
 */

import { DISPATCH_VERBS, vizAsTools } from '../../src/agent/index.js';
import type { VizToolResult, VizToolsPort } from '../../src/agent/index.js';
import type { InteractionSession } from '../../src/session/index.js';
import { LARGE, REALISTIC, SHAPES, SMALL, makeDashboard, planColumns, planViews, shapeLabel, type ShapeSpec } from './shapes.js';

// ── bytes ────────────────────────────────────────────────────────────────────

/** UTF-8 bytes of a value's JSON serialization. The one unit this bench reports. */
const B = (v: unknown): number => Buffer.byteLength(JSON.stringify(v) ?? 'undefined', 'utf8');
/** UTF-8 bytes of a string. */
const SB = (s: string): number => Buffer.byteLength(s, 'utf8');

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 10000) / 100);

// ── 3: composition, by serializing each subtree ──────────────────────────────

interface Share {
  readonly key: string;
  readonly bytes: number;
  readonly share: number;
  /** For a key whose value is a list or a map: how many entries carry those bytes. */
  readonly count?: number;
}

/**
 * Byte share of every top-level key. An entry's bytes = its quoted key + the
 * colon + its serialized value; the object's own braces and commas are the
 * residual, which the caller checks against the whole so the split is provably
 * complete rather than plausibly complete.
 */
function composition(answer: Record<string, unknown>): { shares: Share[]; total: number; residual: number } {
  const total = B(answer);
  const shares: Share[] = [];
  let sum = 0;
  for (const [k, v] of Object.entries(answer)) {
    if (v === undefined) continue;
    const bytes = B(k) + 1 + B(v);
    sum += bytes;
    const count = Array.isArray(v) ? v.length : v !== null && typeof v === 'object' ? Object.keys(v).length : undefined;
    shares.push({ key: k, bytes, share: pct(bytes, total), ...(count === undefined ? {} : { count }) });
  }
  shares.sort((a, b) => b.bytes - a.bytes);
  // braces (2) + one comma between entries
  const separators = 2 + Math.max(0, shares.length - 1);
  return { shares, total, residual: total - sum - separators };
}

/**
 * Second level, same method: for a LIST-valued key, the byte share of each
 * sub-key summed over the entries. "views is 59% of the answer" is a fact; it
 * is not yet an answer to "why", and the why is what a shrink would act on.
 */
function subComposition(list: readonly unknown[]): { shares: Share[]; total: number } {
  const total = B(list);
  const by = new Map<string, { bytes: number; count: number }>();
  for (const el of list) {
    if (el === null || typeof el !== 'object') continue;
    for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
      if (v === undefined) continue;
      const cur = by.get(k) ?? { bytes: 0, count: 0 };
      cur.bytes += B(k) + 1 + B(v);
      cur.count += 1;
      by.set(k, cur);
    }
  }
  const shares = [...by].map(([key, v]) => ({ key, bytes: v.bytes, share: pct(v.bytes, total), count: v.count }));
  shares.sort((a, b) => b.bytes - a.bytes);
  return { shares, total };
}

// ── 4: churn ─────────────────────────────────────────────────────────────────

/**
 * How many bytes of `JSON.stringify(a)` are still there, in the same place,
 * in `b`. Recursive and structural: identical subtrees count whole; an object
 * counts each key it shares; an array is compared position by position (a
 * shifted list is honestly reported as changed, because to a cache it is).
 *
 * Deliberately CONSERVATIVE — braces, brackets and commas are never counted as
 * stable, only quoted keys, colons and values — so the reported fraction is a
 * floor on how much is really unchanged, never a flattering ceiling.
 */
function stableBytes(a: unknown, b: unknown): number {
  const sa = JSON.stringify(a);
  if (sa === undefined) return 0;
  if (sa === JSON.stringify(b)) return SB(sa);
  if (Array.isArray(a) && Array.isArray(b)) {
    let n = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) n += stableBytes(a[i], b[i]);
    return n;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ob = b as Record<string, unknown>;
    let n = 0;
    for (const [k, va] of Object.entries(a as Record<string, unknown>)) {
      if (!(k in ob)) continue;
      const inner = stableBytes(va, ob[k]);
      if (inner > 0) n += B(k) + 1 + inner;
    }
    return n;
  }
  return 0;
}

interface ChurnRow {
  readonly shape: string;
  readonly act: string;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  /** Bytes in top-level keys whose whole subtree serialized identically. */
  readonly topLevelStableBytes: number;
  readonly topLevelStablePct: number;
  /** Bytes unchanged at any depth (the conservative recursive measure). */
  readonly deepStableBytes: number;
  readonly deepStablePct: number;
  /** Top-level keys that changed, biggest first, with the bytes they cost. */
  readonly changedKeys: readonly { key: string; beforeBytes: number; afterBytes: number }[];
}

function churnOf(shape: string, act: string, before: Record<string, unknown>, after: Record<string, unknown>): ChurnRow {
  const beforeBytes = B(before);
  let topLevelStableBytes = 0;
  const changedKeys: { key: string; beforeBytes: number; afterBytes: number }[] = [];
  for (const [k, v] of Object.entries(before)) {
    const entry = B(k) + 1 + B(v);
    if (JSON.stringify(v) === JSON.stringify(after[k])) topLevelStableBytes += entry;
    else changedKeys.push({ key: k, beforeBytes: entry, afterBytes: B(k) + 1 + B(after[k]) });
  }
  changedKeys.sort((a, b) => b.beforeBytes - a.beforeBytes);
  const deepStableBytes = stableBytes(before, after);
  return {
    shape,
    act,
    beforeBytes,
    afterBytes: B(after),
    topLevelStableBytes,
    topLevelStablePct: pct(topLevelStableBytes, beforeBytes),
    deepStableBytes,
    deepStablePct: pct(deepStableBytes, beforeBytes),
    changedKeys,
  };
}

// ── 5: the floor ─────────────────────────────────────────────────────────────

interface ViewRow {
  readonly viewId: string;
  readonly canProbe: boolean;
  readonly selectionKinds: readonly string[];
  readonly columns: readonly { field: string }[];
}

/**
 * The smallest subset of the answer that still supports a FIRST CORRECT ACT.
 * A judgement — say what it is so a reader can disagree:
 *
 *  `strict`  — the view ids, each view's fields, its emission kinds and whether
 *              it can be probed at all, plus the dispatch verbs and the default
 *              table. Enough to name a view, name a column on it, and choose a
 *              verb. It repeats the field list per view, exactly as the answer
 *              does today.
 *  `shared`  — the same facts with the column list stated ONCE. Every view
 *              currently reads the session's single default table, so the
 *              per-view repetition is redundancy, not information. Not what
 *              ships; what could ship.
 *  `verbs`   — the verb list's own bytes, broken out, because a host already
 *              has them in the tool menu's `verb` enum: an answer that omitted
 *              them would lose nothing.
 */
function floorOf(answer: Record<string, unknown>): { strict: number; shared: number; verbs: number; strictPct: number; sharedPct: number } {
  const total = B(answer);
  const views = (answer['views'] ?? []) as readonly ViewRow[];
  const verbs = [...DISPATCH_VERBS];
  const strict = {
    defaultTable: answer['defaultTable'],
    verbs,
    views: views.map((v) => ({ viewId: v.viewId, canProbe: v.canProbe, selectionKinds: v.selectionKinds, fields: v.columns.map((c) => c.field) })),
  };
  const shared = {
    defaultTable: answer['defaultTable'],
    verbs,
    fields: views[0]?.columns.map((c) => c.field) ?? [],
    views: views.map((v) => ({ viewId: v.viewId, canProbe: v.canProbe, selectionKinds: v.selectionKinds })),
  };
  return { strict: B(strict), shared: B(shared), verbs: B(verbs), strictPct: pct(B(strict), total), sharedPct: pct(B(shared), total) };
}

// ── acts (churn inputs) ──────────────────────────────────────────────────────

interface Act {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Three ordinary acts. The two selections come off the shape's own plan (so
 * they always name a real view and a real column); the reencode is derived
 * from the LIVE answer, because in a dense link graph most channels are
 * FOLLOWED and a rebind of one of those is legitimately refused — the act has
 * to be found, not assumed.
 */
function actsFor(spec: ShapeSpec, before: Record<string, unknown>): Act[] {
  const p = planColumns(spec.columns);
  const views = planViews(spec, p);
  const bar = views.find((v) => v.kind === 'bar') ?? views[0]!;
  const point = views.find((v) => v.kind === 'point') ?? views[0]!;
  const dim = bar.initial['x']!;
  const measure = point.initial['y']!;
  const acts: Act[] = [
    { name: 'select (point value on a bar)', args: { verb: 'select', viewId: bar.viewId, field: dim, value: `${dim}_v1` } },
    { name: 'filter (interval on a scatter)', args: { verb: 'filter', viewId: point.viewId, field: measure, range: [20, 60] } },
  ];
  const reencode = findReencode(before);
  if (reencode) acts.push(reencode);
  return acts;
}

interface AnswerView {
  readonly viewId: string;
  readonly encodings: Readonly<Record<string, string>>;
  readonly accepts?: Readonly<Record<string, readonly string[]>>;
  readonly effective?: { readonly followed?: Readonly<Record<string, unknown>> };
}

/** The first (view, channel, column) rebind the encoding plane and the link graph both allow. */
function findReencode(answer: Record<string, unknown>): Act | undefined {
  for (const v of (answer['views'] ?? []) as readonly AnswerView[]) {
    for (const [channel, current] of Object.entries(v.encodings)) {
      if (v.effective?.followed && channel in v.effective.followed) continue; // a followed channel is refused by design
      const field = (v.accepts?.[channel] ?? []).find((f) => f !== current);
      if (field !== undefined) return { name: 'reencode (rebind one channel)', args: { verb: 'reencode', viewId: v.viewId, channel, field } };
    }
  }
  return undefined;
}

// ── the run ──────────────────────────────────────────────────────────────────

interface ToolRow {
  readonly name: string;
  readonly bytes: number;
  readonly descriptionBytes: number;
  readonly schemaBytes: number;
}

interface ShapeRow {
  readonly shape: string;
  readonly label: string;
  readonly spec: ShapeSpec;
  /** What the def actually produced, so the row's shape is the REAL one, not the requested one. */
  readonly declaredViews: number;
  readonly materializedEdges: number;
  readonly tableColumns: number;
  readonly declaredAnalyses: number;
  readonly whatsHereBytes: number;
  readonly composition: readonly Share[];
  readonly compositionResidual: number;
  /** Inside `views`: which sub-key carries the bytes, summed over the views. */
  readonly viewsBreakdown: readonly Share[];
  /** Inside `links`: the graph's own top-level split (edges vs views vs default). */
  readonly linksBreakdown: readonly Share[];
  readonly floor: ReturnType<typeof floorOf>;
}

interface Session {
  readonly session: InteractionSession;
  readonly port: VizToolsPort;
}

function open(spec: ShapeSpec): Session {
  const session = makeDashboard(spec).createSession();
  return { session, port: vizAsTools(session) };
}

async function here(port: VizToolsPort): Promise<Record<string, unknown>> {
  return (await port.call('viz.whats_here')) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const log = (s: string): void => void process.stderr.write(`${s}\n`);

  // ── 1: the menu ────────────────────────────────────────────────────────────
  const menuByShape = new Map<string, string>();
  const perShapeMenuAfterAct = new Map<string, string>();
  let toolRows: ToolRow[] = [];
  for (const spec of SHAPES) {
    const { port } = open(spec);
    const tools = port.tools();
    menuByShape.set(spec.name, JSON.stringify(tools));
    if (spec.name === REALISTIC.name) {
      toolRows = tools.map((t) => ({ name: t.name, bytes: B(t), descriptionBytes: B(t.description), schemaBytes: B(t.inputSchema) }));
    }
  }
  // stability across the life of a session: before any act, and after each act
  {
    const { port } = open(REALISTIC);
    const first = JSON.stringify(port.tools());
    const before = await here(port);
    for (const act of actsFor(REALISTIC, before)) await port.call('viz.dispatch', act.args);
    await port.call('viz.bookmark', { label: 'bench' });
    perShapeMenuAfterAct.set(REALISTIC.name, JSON.stringify(port.tools()));
    perShapeMenuAfterAct.set('__first', first);
  }
  const menuStrings = [...menuByShape.values()];
  const shapeIndependent = menuStrings.every((s) => s === menuStrings[0]);
  const sessionStable = perShapeMenuAfterAct.get('__first') === perShapeMenuAfterAct.get(REALISTIC.name);
  const menuBytes = SB(menuStrings[0]!);
  const menu = {
    bytes: menuBytes,
    tools: toolRows,
    toolCount: toolRows.length,
    /** The docstring says the tool array never changes for the life of a session. Verified, not assumed. */
    stability: {
      shapeIndependent,
      sessionStable,
      ok: shapeIndependent && sessionStable,
      note:
        shapeIndependent && sessionStable
          ? 'byte-identical across all three shapes and across a session that acted — the documented claim holds'
          : 'DEFECT: the tool menu is NOT byte-stable — prompt caches will break on it. See shapeIndependent / sessionStable.',
      perShapeBytes: Object.fromEntries([...menuByShape].map(([k, v]) => [k, SB(v)])),
    },
  };
  log(`menu ${menuBytes} bytes · ${toolRows.length} tools · stable=${menu.stability.ok}`);

  // ── 2 + 3 + 5: the answer, its composition, its floor ──────────────────────
  const shapeRows: ShapeRow[] = [];
  const answers = new Map<string, Record<string, unknown>>();
  for (const spec of SHAPES) {
    const { port } = open(spec);
    const answer = await here(port);
    answers.set(spec.name, answer);
    const comp = composition(answer);
    const links = answer['links'] as { edges?: unknown[] } | undefined;
    const columns = answer['columns'] as Record<string, unknown[]> | undefined;
    const analyses = answer['analyses'] as unknown[] | undefined;
    shapeRows.push({
      shape: spec.name,
      label: shapeLabel(spec),
      spec,
      declaredViews: (answer['views'] as unknown[]).length,
      materializedEdges: links?.edges?.length ?? 0,
      tableColumns: Object.values(columns ?? {})[0]?.length ?? 0,
      declaredAnalyses: analyses?.length ?? 0,
      whatsHereBytes: comp.total,
      composition: comp.shares,
      compositionResidual: comp.residual,
      viewsBreakdown: subComposition((answer['views'] ?? []) as unknown[]).shares,
      linksBreakdown: composition((answer['links'] ?? {}) as Record<string, unknown>).shares,
      floor: floorOf(answer),
    });
    log(`${spec.name.padEnd(10)} whats_here ${String(comp.total).padStart(8)} bytes · ${links?.edges?.length ?? 0} edges · residual ${comp.residual}`);
  }

  // ── 4: churn ───────────────────────────────────────────────────────────────
  const churn: ChurnRow[] = [];
  for (const spec of SHAPES) {
    const probe = open(spec);
    for (const act of actsFor(spec, await here(probe.port))) {
      // a FRESH session per act, so one act's churn is never compounded with another's
      const { port } = open(spec);
      const before = await here(port);
      const res = await port.call('viz.dispatch', act.args);
      if (res['ok'] !== true) throw new Error(`bench act failed on ${spec.name} (${act.name}): ${JSON.stringify(res)}`);
      const after = await here(port);
      const row = churnOf(spec.name, act.name, before, after);
      churn.push(row);
      log(`${spec.name.padEnd(10)} churn ${act.name.padEnd(32)} unchanged ${String(row.deepStablePct).padStart(6)}% deep / ${String(row.topLevelStablePct).padStart(6)}% top-level`);
    }
  }

  // ── optional: real tokens ──────────────────────────────────────────────────
  const tokens = await countTokens({ menu: menuStrings[0]!, answers, shapeRows, log });

  const out = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    generatedAt: new Date().toISOString(),
    unit: 'UTF-8 bytes of the JSON serialization (Buffer.byteLength). Tokens only ever come from the optional --tokens pass.',
    menu,
    shapes: shapeRows,
    churn,
    tokens,
  };
  process.stdout.write(JSON.stringify(out, null, 1));
}

// ── the optional token pass ──────────────────────────────────────────────────

interface TokenResult {
  readonly counted: boolean;
  readonly reason?: string;
  readonly model?: string;
  readonly rows?: readonly { what: string; bytes: number; tokens: number; bytesPerToken: number }[];
  readonly note?: string;
}

/**
 * Tokens, only from the real endpoint. Never estimated, never derived from
 * bytes, never printed unless a real count came back. No key is ever read from
 * a file, echoed, or written into an output.
 */
async function countTokens(args: {
  menu: string;
  answers: Map<string, Record<string, unknown>>;
  shapeRows: readonly ShapeRow[];
  log: (s: string) => void;
}): Promise<TokenResult> {
  if (process.env['SURFACE_TOKENS'] !== '1') {
    return { counted: false, reason: 'not requested — run with --tokens to count real tokens' };
  }
  const hasKey = Boolean(process.env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_AUTH_TOKEN']);
  if (!hasKey) {
    args.log('tokens NOT counted: no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment. Bytes only.');
    return { counted: false, reason: 'no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment' };
  }
  let Anthropic: new () => {
    messages: { countTokens(body: Record<string, unknown>): Promise<{ input_tokens: number }> };
  };
  try {
    // @ts-ignore — an OPTIONAL dependency: not in package.json, and the whole point of this
    // branch is the case where it is absent. `run.mjs` marks it external so the bundle builds either way.
    const mod = (await import('@anthropic-ai/sdk')) as { default: typeof Anthropic };
    Anthropic = mod.default;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    args.log(`tokens NOT counted: @anthropic-ai/sdk is not importable (${why}). Bytes only.`);
    return { counted: false, reason: `@anthropic-ai/sdk is not importable (${why})` };
  }
  const model = process.env['SURFACE_TOKENS_MODEL'] ?? 'claude-opus-5';
  const client = new Anthropic();
  const rows: { what: string; bytes: number; tokens: number; bytesPerToken: number }[] = [];
  const count = async (what: string, text: string): Promise<void> => {
    const res = await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] });
    const bytes = SB(text);
    rows.push({ what, bytes, tokens: res.input_tokens, bytesPerToken: Math.round((bytes / res.input_tokens) * 100) / 100 });
    args.log(`tokens ${what.padEnd(28)} ${String(bytes).padStart(8)} bytes → ${String(res.input_tokens).padStart(7)} tokens`);
  };
  await count('menu (as text)', args.menu);
  for (const row of args.shapeRows) {
    await count(`whats_here ${row.shape}`, JSON.stringify(args.answers.get(row.shape)));
  }
  return {
    counted: true,
    model,
    rows,
    note:
      'Counted by Anthropic\'s /v1/messages/count_tokens for the serialized JSON as one user message. A host frames tools and ' +
      'tool_results differently, so these are the cost of the TEXT, not of a particular request envelope. Do not turn the ' +
      'bytes-per-token column into a constant: it is a property of THIS content at THIS model.',
  };
}

await main();
