/**
 * The PURE, runtime-free chart-spec shape gate — the ONE place the renderer
 * protocol's structural rules live (RP-3 / D28). It answers "may an
 * agent-proposed chart spec ride the governed pipeline at all?" over a plain
 * JSON object, with NO Vega-Lite runtime (not even a `import type` from
 * `vega-lite`): a spec is an opaque `Record<string, unknown>`.
 *
 * WHY IT LIVES IN CORE (the dependency-direction decision, D28): the published
 * `vizfootprint` library must be able to gate an agent's proposed chart with
 * ZERO charting dependency installed — an agent pre-flights a spec, the session
 * ledgers it as a hypothesis, all before any bridge exists. The actual RENDER
 * is a bridge/UI concern (`bridges/vega-lite`, `vizfootprint-ui`). So the
 * SHAPE RULE (what counts as a host-owned transform, what counts as
 * unsupported multi-view composition, what a single-view spec is) is defined
 * HERE and CONSUMED by the bridge (`bridges/vega-lite/src/specGate.ts` calls
 * {@link analyzeSpecShape}), never the reverse — core → bridge would invert the
 * package graph and drag Vega-Lite into the library's install closure.
 *
 * The rule is single-sourced; the WORDING is per-consumer. {@link analyzeSpecShape}
 * returns STRUCTURED FACTS (which composition keys are present, which transform
 * ops, whether a mark/opacity/inline-data is present, which fields are
 * encoded); the core pipeline ({@link gateChartSpec}) and the Vega-Lite bridge
 * each phrase their own messages from those facts, so the bridge's exact
 * v1-worded issue strings never drift from this detection.
 *
 * Rationale for gating at all (renderer-protocol.md §1d/§5, D27): raw LLM→VL
 * validity is too low to trust (DracoGPT, arXiv:2408.06845), and a spec
 * carrying its own aggregation double-transforms host-owned data and breaks the
 * raw-key emission contract — so the host owns every bin/aggregate/decimate and
 * a transform-carrying spec is refused, never silently rendered.
 */

/**
 * Multi-view composition keys. A spec carrying any of these is NOT a single
 * view — bridge v1 (and therefore the governed pipeline) hosts exactly one
 * single-view mark. Frozen; the Vega-Lite bridge imports this list so the two
 * layers cannot disagree about what "composition" means.
 */
export const CHART_COMPOSITION_KEYS = [
  'facet',
  'repeat',
  'layer',
  'concat',
  'hconcat',
  'vconcat',
  'spec',
] as const;

/**
 * The transform-array op keys the gate can name. Anything else in a transform
 * entry reports as the generic `'transform'`. (Encoding-level
 * `bin`/`aggregate`/`timeUnit` are detected separately, per channel.)
 */
export const CHART_TRANSFORM_OPS = [
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

/**
 * One detected host-owned transform. A transform-array op has no `channel`; an
 * encoding-level `bin`/`aggregate`/`timeUnit` carries the channel it rides
 * (a consumer formats it as e.g. `bin(x)`).
 */
export interface DetectedTransform {
  readonly op: string;
  readonly channel?: string;
}

/** The structured shape facts read off a spec — the single detection, worded per-consumer. */
export interface SpecShapeFacts {
  /** The spec is a plain object (not null / array / primitive). */
  readonly isObject: boolean;
  /** The spec declares a single-view `mark`. */
  readonly hasMark: boolean;
  /** The multi-view composition keys present (empty for a single view). */
  readonly composition: readonly string[];
  /** The host-owned transforms the spec carries (transform-array ops + encoding-level bin/aggregate/timeUnit). */
  readonly transforms: readonly DetectedTransform[];
  /** The spec carries an `opacity` encoding channel (bridge-owned in v1 — the highlight rides it). */
  readonly hasOpacityEncoding: boolean;
  /** The spec carries its own inline `data` (the host replaces it — noted, never silent). */
  readonly hasInlineData: boolean;
  /** Distinct data fields referenced by the spec's encoding channels, in channel order. */
  readonly encodedFields: readonly string[];
}

interface EncodingDefShape {
  readonly field?: unknown;
  readonly bin?: unknown;
  readonly aggregate?: unknown;
  readonly timeUnit?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read a spec's structural facts. PURE — no Vega-Lite import, no DOM, no
 * mutation of the input. Both the core pipeline and the Vega-Lite bridge call
 * this and word their own refusals from the result.
 */
export function analyzeSpecShape(spec: unknown): SpecShapeFacts {
  if (!isRecord(spec)) {
    return {
      isObject: false,
      hasMark: false,
      composition: [],
      transforms: [],
      hasOpacityEncoding: false,
      hasInlineData: false,
      encodedFields: [],
    };
  }

  const composition = CHART_COMPOSITION_KEYS.filter((k) => spec[k] !== undefined);

  const transforms: DetectedTransform[] = [];
  const transformArray = spec['transform'];
  if (Array.isArray(transformArray)) {
    for (const t of transformArray) {
      if (!isRecord(t)) {
        transforms.push({ op: 'transform' });
        continue;
      }
      const op = CHART_TRANSFORM_OPS.find((k) => t[k] !== undefined);
      transforms.push({ op: op ?? 'transform' });
    }
  }

  const encoding = isRecord(spec['encoding']) ? (spec['encoding'] as Record<string, EncodingDefShape>) : undefined;
  const encodedFields: string[] = [];
  if (encoding) {
    for (const [channel, def] of Object.entries(encoding)) {
      if (!isRecord(def)) continue;
      if (def.bin !== undefined && def.bin !== false) transforms.push({ op: 'bin', channel });
      if (def.aggregate !== undefined) transforms.push({ op: 'aggregate', channel });
      if (def.timeUnit !== undefined) transforms.push({ op: 'timeUnit', channel });
      if (typeof def.field === 'string' && !encodedFields.includes(def.field)) encodedFields.push(def.field);
    }
  }

  return {
    isObject: true,
    hasMark: spec['mark'] !== undefined,
    composition,
    transforms,
    hasOpacityEncoding: encoding?.['opacity'] !== undefined,
    hasInlineData: spec['data'] !== undefined,
    encodedFields,
  };
}

/** The typed reason the shape gate refuses a spec (one per pipeline stage). */
export type ChartGateReason = 'invalid-spec' | 'unsupported-composition' | 'transforms-not-owned';

export type ChartShapeVerdict =
  | { readonly ok: true; readonly facts: SpecShapeFacts }
  | { readonly ok: false; readonly reason: ChartGateReason; readonly detail: string; readonly facts: SpecShapeFacts };

/**
 * The governed pipeline's shape gate (RP-3 stages "schema-valid" +
 * "capability-check"): a spec passes iff it is a single-view object with a mark
 * that carries no host-owned transforms. Order matters — a not-an-object spec
 * can't be inspected for composition, and composition is reported before the
 * transform sweep. `detail` strings are INERT (R12): human-facing, never
 * parsed or dispatched on.
 */
export function gateChartSpec(spec: unknown): ChartShapeVerdict {
  const facts = analyzeSpecShape(spec);
  if (!facts.isObject) {
    return { ok: false, reason: 'invalid-spec', detail: 'the chart spec must be a plain JSON object', facts };
  }
  if (facts.composition.length > 0) {
    return {
      ok: false,
      reason: 'unsupported-composition',
      detail: `multi-view composition (${facts.composition.join(', ')}) is not supported — propose one single-view chart`,
      facts,
    };
  }
  if (!facts.hasMark) {
    return { ok: false, reason: 'invalid-spec', detail: 'the chart spec declares no mark — one single-view mark is required', facts };
  }
  if (facts.transforms.length > 0) {
    const names = facts.transforms.map((t) => (t.channel ? `${t.op}(${t.channel})` : t.op));
    return {
      ok: false,
      reason: 'transforms-not-owned',
      detail: `the spec carries its own data transforms (${names.join(', ')}) — the host owns all binning/aggregation/decimation; remove them and let the host prepare the rows`,
      facts,
    };
  }
  return { ok: true, facts };
}
