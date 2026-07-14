/**
 * The spec gate — every consumer Vega-Lite spec is validated HERE, before a
 * single vega module runs (the renderer-protocol panel's transform-ownership
 * rule, D27 §1d/§6, written down before the first bridge shipped).
 *
 * Two distinct outcomes, two distinct honesty paths:
 *
 *  1. INTERNAL TRANSFORMS (`transform: [...]`, or encoding-level
 *     `bin`/`aggregate`/`timeUnit`): the spec is NOT rejected here. The gate
 *     records the transform names and `vegaLiteRenderer` answers its mount
 *     hello with `transforms: [...names]` — so the HOST's `bindRenderer`
 *     refuses the bind with the contract's own typed `transforms-not-owned`
 *     gap (ui/src/contract/bind.ts). The host owns ALL binning/aggregation/
 *     decimation; rows arrive prepared.
 *
 *  2. UNSUPPORTED IN BRIDGE V1 (multi-view composition, 2-axis brushes,
 *     key-less point selections, an opacity encoding, no selection param at
 *     all): `validateVegaLiteSpec` returns the typed issues and
 *     `vegaLiteRenderer` THROWS a {@link VegaLiteSpecError} at the factory —
 *     fail-fast and typed, never a silent subset.
 *
 * What v1 honestly supports: ONE single-view spec (one `mark`), at most one
 * interval brush param on exactly one positional axis (quantitative or
 * temporal), at most one point param naming exactly one field, and at most
 * one `bind: 'scales'` interval param (pan/zoom → the `navigate` verb).
 */

import type { TopLevelSpec } from 'vega-lite';

/** A typed spec-gate refusal — the reason a spec cannot ride bridge v1. */
export interface SpecGateIssue {
  readonly code: 'unsupported-in-bridge-v1';
  /** Human-facing detail. INERT — never parsed, never dispatched on. */
  readonly detail: string;
}

/** The interval-brush param the gate resolved (one positional axis, one field). */
export interface GatedBrush {
  readonly param: string;
  readonly channel: 'x' | 'y';
  readonly field: string;
  /** True when the axis encoding is temporal — emissions become ISO date strings. */
  readonly temporal: boolean;
}

/** The point-select param the gate resolved (exactly one named field). */
export interface GatedPoint {
  readonly param: string;
  readonly field: string;
}

/** One pan/zoom axis of a `bind: 'scales'` param. */
export interface GatedNavigateChannel {
  readonly channel: 'x' | 'y';
  readonly field: string;
  readonly temporal: boolean;
}

/** The `bind: 'scales'` (pan/zoom) param the gate resolved. */
export interface GatedNavigate {
  readonly param: string;
  readonly channels: readonly GatedNavigateChannel[];
}

/** Everything the renderer needs, resolved once — the spec itself is never mutated. */
export interface GatedSpec {
  readonly spec: TopLevelSpec;
  readonly brush: GatedBrush | null;
  readonly point: GatedPoint | null;
  readonly navigate: GatedNavigate | null;
  /**
   * Internal data transforms the spec carries. Non-empty ⇒ the renderer
   * DECLARES them in its hello and the host refuses the bind with the typed
   * `transforms-not-owned` gap — path 1 in the file header.
   */
  readonly internalTransforms: readonly string[];
  /** Plain-words notes about host-owned replacements (e.g. inline data). Never silent. */
  readonly notes: readonly string[];
}

export type SpecGateResult =
  | { readonly ok: true; readonly gated: GatedSpec }
  | { readonly ok: false; readonly issues: readonly SpecGateIssue[] };

/** The typed error `vegaLiteRenderer` throws for a spec bridge v1 cannot host. */
export class VegaLiteSpecError extends Error {
  readonly issues: readonly SpecGateIssue[];
  constructor(issues: readonly SpecGateIssue[]) {
    super(`vega-lite bridge v1 cannot host this spec: ${issues.map((i) => i.detail).join('; ')}`);
    this.name = 'VegaLiteSpecError';
    this.issues = issues;
  }
}

// ── structural probes (VL's own types are too wide to switch on directly) ──────

interface EncodingDefShape {
  readonly field?: unknown;
  readonly type?: unknown;
  readonly bin?: unknown;
  readonly aggregate?: unknown;
  readonly timeUnit?: unknown;
}

interface ParamShape {
  readonly name?: unknown;
  readonly select?: unknown;
  readonly bind?: unknown;
}

interface SpecShape {
  readonly mark?: unknown;
  readonly encoding?: Readonly<Record<string, EncodingDefShape>>;
  readonly params?: readonly ParamShape[];
  readonly transform?: readonly Readonly<Record<string, unknown>>[];
  readonly data?: unknown;
}

const MULTI_VIEW_KEYS = ['facet', 'repeat', 'layer', 'concat', 'hconcat', 'vconcat', 'spec'] as const;

/** The transform-array op keys we can name in the hello (anything else reports as 'transform'). */
const TRANSFORM_OPS = [
  'aggregate',
  'bin',
  'calculate',
  'density',
  'extent',
  'filter',
  'flatten',
  'fold',
  'impute',
  'joinaggregate',
  'loess',
  'lookup',
  'pivot',
  'quantile',
  'regression',
  'sample',
  'stack',
  'timeUnit',
  'window',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The select clause's type ('interval' | 'point' | …), from either VL shorthand. */
function selectType(select: unknown): string | null {
  if (typeof select === 'string') return select;
  if (isRecord(select) && typeof select['type'] === 'string') return select['type'];
  return null;
}

/** Resolve a positional channel to its encoded field, or null when it has none. */
function channelField(
  encoding: Readonly<Record<string, EncodingDefShape>> | undefined,
  channel: 'x' | 'y',
): { field: string; temporal: boolean } | null {
  const def = encoding?.[channel];
  if (!def || typeof def.field !== 'string') return null;
  return { field: def.field, temporal: def.type === 'temporal' };
}

/**
 * Validate one consumer spec against what bridge v1 honestly supports.
 * Pure — no vega import, no DOM; agents can pre-flight a proposed spec with
 * this exact function (the D27 §5 pipeline's capability-check stage).
 */
export function validateVegaLiteSpec(spec: TopLevelSpec): SpecGateResult {
  const shape = spec as unknown as SpecShape & Record<string, unknown>;
  const issues: SpecGateIssue[] = [];
  const notes: string[] = [];

  // ── multi-view composition: honestly out of v1, never a silent subset ──
  const multi = MULTI_VIEW_KEYS.filter((k) => shape[k] !== undefined);
  if (multi.length > 0) {
    issues.push({
      code: 'unsupported-in-bridge-v1',
      detail: `multi-view composition (${multi.join(', ')}) is not supported in bridge v1 — one single-view mark only`,
    });
    return { ok: false, issues };
  }
  if (shape.mark === undefined) {
    issues.push({
      code: 'unsupported-in-bridge-v1',
      detail: 'the spec declares no mark — bridge v1 hosts exactly one single-view mark',
    });
    return { ok: false, issues };
  }

  // ── internal transforms: recorded for the hello, refused by the HOST at bind ──
  const internalTransforms: string[] = [];
  for (const t of shape.transform ?? []) {
    const op = TRANSFORM_OPS.find((k) => t[k] !== undefined);
    internalTransforms.push(op ?? 'transform');
  }
  const encoding = shape.encoding;
  for (const [channel, def] of Object.entries(encoding ?? {})) {
    if (def.bin !== undefined && def.bin !== false) internalTransforms.push(`bin(${channel})`);
    if (def.aggregate !== undefined) internalTransforms.push(`aggregate(${channel})`);
    if (def.timeUnit !== undefined) internalTransforms.push(`timeUnit(${channel})`);
  }
  if (internalTransforms.length > 0) {
    // path 1 (file header): mount a hello that declares them; the host refuses.
    return {
      ok: true,
      gated: { spec, brush: null, point: null, navigate: null, internalTransforms, notes },
    };
  }

  // ── the opacity channel is bridge-owned in v1 (the crossfilter highlight rides it) ──
  if (encoding?.['opacity'] !== undefined) {
    issues.push({
      code: 'unsupported-in-bridge-v1',
      detail: 'the opacity encoding channel is bridge-owned in v1 — the host-selection highlight rides it',
    });
  }

  // ── params: resolve the (at most one each) brush / point / scales params ──
  let brush: GatedBrush | null = null;
  let point: GatedPoint | null = null;
  let navigate: GatedNavigate | null = null;
  for (const p of shape.params ?? []) {
    const name = typeof p.name === 'string' ? p.name : '';
    const kind = selectType(p.select);
    if (kind === null) continue; // a variable param — inert for the contract; allowed
    if (kind === 'interval' && p.bind === 'scales') {
      if (navigate !== null) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `more than one bind:'scales' param (${navigate.param}, ${name}) — bridge v1 wires exactly one`,
        });
        continue;
      }
      const channels: GatedNavigateChannel[] = [];
      for (const channel of ['x', 'y'] as const) {
        const f = channelField(encoding, channel);
        if (f) channels.push({ channel, ...f });
      }
      if (channels.length === 0) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `the bind:'scales' param "${name}" has no positional field encoding to navigate over`,
        });
        continue;
      }
      navigate = { param: name, channels };
      continue;
    }
    if (kind === 'interval') {
      if (brush !== null) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `more than one interval param (${brush.param}, ${name}) — one live clause per view is the session's rule`,
        });
        continue;
      }
      const encodings = isRecord(p.select) ? p.select['encodings'] : undefined;
      const axis = Array.isArray(encodings) && encodings.length === 1 ? encodings[0] : null;
      if (axis !== 'x' && axis !== 'y') {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `the interval param "${name}" must declare encodings: ['x'] or ['y'] — a 2-axis brush is not one clause`,
        });
        continue;
      }
      const f = channelField(encoding, axis);
      if (!f) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `the interval param "${name}" brushes ${axis}, but ${axis} has no field encoding`,
        });
        continue;
      }
      const def = encoding?.[axis];
      if (def?.type !== 'quantitative' && def?.type !== 'temporal') {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `the interval param "${name}" brushes a ${String(def?.type)} axis — quantitative or temporal only`,
        });
        continue;
      }
      brush = { param: name, channel: axis, field: f.field, temporal: f.temporal };
      continue;
    }
    if (kind === 'point') {
      if (point !== null) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `more than one point param (${point.param}, ${name}) — one live clause per view is the session's rule`,
        });
        continue;
      }
      const field = resolvePointField(p, encoding);
      if (field === null) {
        issues.push({
          code: 'unsupported-in-bridge-v1',
          detail: `the point param "${name}" must name exactly one field (fields: ['…']) or one field-encoded channel — the default datum-key selection has no host field`,
        });
        continue;
      }
      point = { param: name, field };
      continue;
    }
    issues.push({
      code: 'unsupported-in-bridge-v1',
      detail: `the param "${name}" selects with unknown type "${kind}"`,
    });
  }

  // ── a contract view must be able to emit — a mute chart is not a view ──
  if (brush === null && point === null) {
    issues.push({
      code: 'unsupported-in-bridge-v1',
      detail: 'no interval or point selection param — a contract view must emit (a mute chart is not a view)',
    });
  }

  if (shape.data !== undefined) {
    notes.push('the spec carries its own data — replaced by host rows (the host owns the data channel)');
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, gated: { spec, brush, point, navigate, internalTransforms: [], notes } };
}

/** A point param's one host field, from `fields: ['f']` or one field-encoded channel. */
function resolvePointField(
  p: ParamShape,
  encoding: Readonly<Record<string, EncodingDefShape>> | undefined,
): string | null {
  if (!isRecord(p.select)) return null; // the string shorthand selects by datum key — untranslatable
  const fields = p.select['fields'];
  if (Array.isArray(fields)) {
    return fields.length === 1 && typeof fields[0] === 'string' ? fields[0] : null;
  }
  const encodings = p.select['encodings'];
  if (Array.isArray(encodings) && encodings.length === 1 && typeof encodings[0] === 'string') {
    const def = encoding?.[encodings[0]];
    return def && typeof def.field === 'string' ? def.field : null;
  }
  return null;
}
