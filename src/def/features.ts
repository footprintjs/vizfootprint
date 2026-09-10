/**
 * WHAT THIS BUILD CAN DO — the feature card of a DASHBOARD, read off the
 * dashboard itself.
 *
 * THE LAW IT FOLLOWS: **a demo's tags are read, never written.** A hand-kept
 * list of "features covered" is a second source of truth beside the def, and a
 * second source of truth goes stale the first time somebody adds a view and
 * forgets the list. Every field below is a PROJECTION of something the build
 * already holds — no new judgement, no vocabulary this module invents.
 *
 * THE SECOND LAW: **a card reports what a build HOLDS or a def DECLARES, and
 * never restates a default that lives in another module.** `linkDefault` and
 * `fdr` are `null` when the def declared none, rather than repeating the
 * fallback `buildDashboard` applies — a card that copied it would be the very
 * drift this reader exists to prevent, and "the author declared no link rule"
 * is a fact worth having on a card anyway.
 *
 * WHY the BUILT {@link Dashboard} and not a raw `DashboardDef`: three of the
 * answers are resolved at build and cannot be read off a definition —
 * `revision` (digested once, over the validated def), `engines` (the engine
 * each table actually routed to, which is not always the one declared) and
 * `sources` (what each source vouched for when it was READ). A reader that
 * took a def would have to re-derive all three.
 *
 * FIRST CUSTOMERS: the demo gallery's per-surface card, and the filter it
 * offers over one. ONE DEMO IS NOT ONE DASHBOARD — the CDC desk builds its def
 * with the co-occurrence graph (a network view, two layers, eight analyses) and
 * its story page builds the same demo WITHOUT it — so a card is per SURFACE,
 * and every fact on it came from the surface it names.
 *
 * Its twin is `../branches/features.ts`, which answers the other question: not
 * what a build CAN do, but what somebody actually DID.
 */

import type { AnalysisKind } from '../analysis/index.js';
import type { Actor } from '../cause/index.js';
import type { Engine } from '../data/index.js';
import type { BusinessRule, RuleScope } from '../encoding/index.js';
import { EMISSION_KINDS, voiceOf } from '../links/index.js';
import type { EmissionKind, LinkDefault, LinkKind, LinkOnClear, LinkResponse } from '../links/index.js';
import type { SourceFormat, SourceVia } from '../source/index.js';
import type { BuiltinAnalysisName } from './builtinAnalyses.js';
import { isBuiltinRecord } from './builtinAnalyses.js';
import type { Dashboard } from './buildDashboard.js';
import { registerAnalysisSlot } from './register.js';
import { DEFAULT_RELATION_KIND } from './relations.js';
import type { AnalysisSlot, DashboardDef, RelationEdge, RelationKind } from './types.js';

// ── The card, as data ─────────────────────────────────────────────────────────

/** One table: the engine it ROUTED to, where its rows came from, and the two things it declared about them. */
export interface TableFeature {
  readonly table: string;
  /** Resolved at build — a table declaring `auto` reports the engine it landed on, never `auto`. */
  readonly engine: Engine;
  /** What the source vouched for when it was read; absent for a table declared as bare `rows`/`csv`. */
  readonly source?: { readonly format: SourceFormat; readonly via: SourceVia; readonly at?: string };
  /** The row-identity column, when the table declares one. */
  readonly key?: string;
  /**
   * The absence vocabularies this table speaks, when it declares any — ONE PER
   * STATE COLUMN, in declaration order, because silence belongs to a column and
   * not to the row (`../data/silence.ts`). A table with a measured radius, a
   * bounded mass and a period never taken lists three.
   */
  readonly absence?: readonly (readonly string[])[];
}

/** One layer of a view — the table it reads and the surface it draws with. */
export interface LayerFeature {
  readonly layerId: string;
  readonly table: string;
  readonly chartKind: string;
  readonly channels: readonly string[];
}

/** One view: who drives it, what it draws, and what it can SAY (its voice). */
export interface ViewFeature {
  readonly viewId: string;
  readonly actor: Actor;
  readonly chartKind?: string;
  readonly channels?: readonly string[];
  /** Present exactly when the view draws more than one table on one frame. */
  readonly layers?: readonly LayerFeature[];
  /** The group keys the view's marks stand for (`[]` = one mark per row); absent = undeclared. */
  readonly grain?: readonly string[];
  /** `voiceOf` — the kinds this view can emit, including the ASSUMED ones when it declares no capability. */
  readonly voice: readonly LinkKind[];
}

/** The link plane as DECLARED: the rule the graph starts from, and what the declared edges say. */
export interface LinkFeature {
  /** `null` = the def declared no rule, and the build's own default applies (law 2). */
  readonly linkDefault: LinkDefault | null;
  /** How many edges the def wrote out itself (the default rule's edges are not counted — nobody declared them). */
  readonly declared: number;
  readonly kinds: readonly LinkKind[];
  readonly responses: readonly LinkResponse[];
  readonly onClear: readonly LinkOnClear[];
  /** Whether any declared edge states how an emission FOLDS onto the target's rows. */
  readonly statesFold: boolean;
}

/** One relation between tables, with the kind the build resolved. */
export interface RelationFeature {
  readonly from: { readonly table: string; readonly column: string };
  readonly to: { readonly table: string; readonly column: string };
  readonly kind: RelationKind;
}

/** One declared analysis: the kind the registry gave it, and the builtin it names when it is data. */
export interface AnalysisFeature {
  readonly id: string;
  readonly kind: AnalysisKind;
  /** Present exactly when the slot was a builtin RECORD — the two code forms name no builtin. */
  readonly builtin?: BuiltinAnalysisName;
}

/** The encoding plane's declared rule set. */
export interface EncodingRulesFeature {
  readonly rules: number;
  readonly kinds: readonly BusinessRule['rule'][];
  /** The chart kinds whose channel requirements the def adds to. */
  readonly chartKinds: readonly string[];
  /** `null` = undeclared (the plane's own default applies — law 2). */
  readonly ruleScope: RuleScope | null;
  readonly onInvalid: string | null;
}

/** The false-discovery settings, exactly as declared. */
export interface FdrFeature {
  readonly procedure: 'LORD++' | 'alpha-investing';
  readonly alpha: number;
  /** Whether the def carries a developer-authored gamma sequence (a function, so never data). */
  readonly statesGamma: boolean;
}

/** Everything one BUILT dashboard can do, as data. */
export interface DashboardFeatures {
  /** Which definition this card was read off — the same string a served answer carries as `basis.revision`. */
  readonly revision: string;
  readonly tables: readonly TableFeature[];
  readonly views: readonly ViewFeature[];
  /** Every chart kind drawn anywhere on the surface — a view's, and a layer's. */
  readonly chartKinds: readonly string[];
  /** Every channel bound anywhere on the surface. */
  readonly channels: readonly string[];
  /** Every SELECTION kind some view can emit (the encoding kind is a binding, not a selection, and is not one). */
  readonly selectionKinds: readonly EmissionKind[];
  readonly links: LinkFeature;
  readonly relations: readonly RelationFeature[];
  readonly analyses: readonly AnalysisFeature[];
  /** The views (and notes) the def writes words for. */
  readonly proseSubjects: readonly string[];
  readonly encodingRules: EncodingRulesFeature;
  /** `null` = the def declared none, and the build's own defaults apply (law 2). */
  readonly fdr: FdrFeature | null;
}

// ── The door ──────────────────────────────────────────────────────────────────

/**
 * The feature card of one built dashboard.
 *
 * ```ts
 * const card = defFeatures(buildDashboard(nndssDef(tables, graph)));
 * card.views.find((v) => v.viewId === 'net')?.layers?.length;  // 2
 * card.selectionKinds.includes('neighbourhood');               // true — a node can be walked from
 * ```
 */
export function defFeatures(dashboard: Dashboard): DashboardFeatures {
  const def = dashboard.def;
  const relations = relationsOf(def);
  const views = viewsOf(def);
  return {
    revision: dashboard.revision,
    tables: tablesOf(dashboard),
    views,
    chartKinds: sortedUnique(views.flatMap(chartKindsOfView)),
    channels: sortedUnique(views.flatMap(channelsOfView)),
    selectionKinds: EMISSION_KINDS.filter((kind) => views.some((v) => v.voice.includes(kind))),
    links: linksOf(def),
    relations,
    analyses: analysesOf(def, relations),
    proseSubjects: (def.prose ?? []).map((p) => p.viewId),
    encodingRules: encodingRulesOf(def),
    fdr: fdrOf(def),
  };
}

// ── Tables: the two facts only a BUILD holds, beside the two the def states ───

function tablesOf(dashboard: Dashboard): readonly TableFeature[] {
  const sources = dashboard.sources;
  return Object.entries(dashboard.def.data).map(([table, decl]) => {
    const info = sources[table];
    return {
      table,
      // the resolved engine, never the declared one: `auto` is a question at declaration
      // and an answer here. Every def table is routed at build, so the entry is always there.
      engine: dashboard.engines[table]!,
      ...(info === undefined ? {} : { source: { format: info.format, via: info.via, ...(info.at === undefined ? {} : { at: info.at }) } }),
      ...(decl.key === undefined ? {} : { key: decl.key }),
      ...(decl.absence === undefined ? {} : { absence: (Array.isArray(decl.absence) ? decl.absence : [decl.absence]).map((entry) => entry.states) }),
    };
  });
}

// ── Views: the declared surface, plus the voice the link graph reads ──────────

function viewsOf(def: DashboardDef): readonly ViewFeature[] {
  const capabilityByView = new Map((def.capabilities ?? []).map((c) => [c.viewId, c] as const));
  const encodingByView = new Map((def.encodings ?? []).map((e) => [e.viewId, e] as const));
  const grainByView = new Map((def.grains ?? []).map((g) => [g.viewId, g.keys] as const));
  return Object.entries(def.actors).map(([viewId, meta]) => {
    const encoding = encodingByView.get(viewId);
    const grain = grainByView.get(viewId);
    return {
      viewId,
      actor: meta.actor,
      ...(encoding === undefined ? {} : { chartKind: encoding.chartKind, channels: encoding.channels }),
      ...(encoding?.layers === undefined ? {} : { layers: encoding.layers.map(layerFeatureOf) }),
      ...(grain === undefined ? {} : { grain }),
      // WHY `voiceOf` and not a rule of our own: it is the ONE answer to "what can
      // this view emit" — the probe guard, the overview and the link graph all read
      // it, so a card that judged differently would advertise a gesture the guard refuses
      voice: voiceOf(capabilityByView.get(viewId), { hasEncodingSurface: encoding !== undefined }),
    };
  });
}

function layerFeatureOf(layer: { readonly layerId: string; readonly table: string; readonly chartKind: string; readonly channels: readonly string[] }): LayerFeature {
  return { layerId: layer.layerId, table: layer.table, chartKind: layer.chartKind, channels: layer.channels };
}

/** A surface draws with its own chart kind AND every layer's — a network view is a `network` over a `link` and a `point`. */
function chartKindsOfView(view: ViewFeature): readonly string[] {
  return [...(view.chartKind === undefined ? [] : [view.chartKind]), ...(view.layers ?? []).map((l) => l.chartKind)];
}

function channelsOfView(view: ViewFeature): readonly string[] {
  return [...(view.channels ?? []), ...(view.layers ?? []).flatMap((l) => l.channels)];
}

// ── Links, relations, analyses, rules, FDR ───────────────────────────────────

function linksOf(def: DashboardDef): LinkFeature {
  const declared = def.links ?? [];
  return {
    linkDefault: def.linkDefault ?? null,
    declared: declared.length,
    kinds: sortedUnique(declared.map((l) => l.kind)) as readonly LinkKind[],
    responses: sortedUnique(declared.map((l) => l.response)) as readonly LinkResponse[],
    onClear: sortedUnique(declared.flatMap((l) => (l.onClear === undefined ? [] : [l.onClear]))) as readonly LinkOnClear[],
    statesFold: declared.some((l) => l.fold !== undefined),
  };
}

/**
 * The relations with the kind RESOLVED — the same one line `buildDashboard`
 * writes onto its runtime, from the same constant, so a card and a session
 * never disagree about a cardinality nobody spelled out.
 */
function relationsOf(def: DashboardDef): readonly RelationEdge[] {
  return (def.relations ?? []).map((r) => ({ from: { ...r.from }, to: { ...r.to }, kind: r.kind ?? DEFAULT_RELATION_KIND }));
}

/**
 * WHY this calls the registry rather than keeping a name→kind table: `kind` is
 * the ANALYSIS's own answer, and the three slot forms answer it three ways (a
 * module carries it, a raw def declares it, a builtin record gets it from the
 * factory it names). `registerAnalysisSlot` is the one place that knows all
 * three — the same call `buildDashboard` already made over these same slots,
 * which is why it cannot throw here on a dashboard that built.
 */
function analysesOf(def: DashboardDef, relations: readonly RelationEdge[]): readonly AnalysisFeature[] {
  return Object.entries(def.analyses ?? {}).map(([id, slot]) => {
    const registered = registerAnalysisSlot(id, slot, { relations });
    const builtin = builtinNameOf(slot);
    return { id, kind: registered.kind, ...(builtin === undefined ? {} : { builtin }) };
  });
}

/** The builtin a slot names, when the slot is a record — the two code forms name none. */
function builtinNameOf(slot: AnalysisSlot): BuiltinAnalysisName | undefined {
  return isBuiltinRecord(slot) ? slot.builtin : undefined;
}

function encodingRulesOf(def: DashboardDef): EncodingRulesFeature {
  const declared = def.encodingRules;
  const rules = declared?.rules ?? [];
  return {
    rules: rules.length,
    kinds: sortedUnique(rules.map((r) => r.rule)) as readonly BusinessRule['rule'][],
    chartKinds: sortedUnique(Object.keys(declared?.channels ?? {})),
    ruleScope: declared?.ruleScope ?? null,
    onInvalid: declared?.onInvalid ?? null,
  };
}

function fdrOf(def: DashboardDef): FdrFeature | null {
  const fdr = def.fdr;
  if (fdr === undefined) return null;
  return { procedure: fdr.procedure, alpha: fdr.alpha, statesGamma: fdr.gamma !== undefined };
}

// ── One shared reducer ────────────────────────────────────────────────────────

/** Every distinct value, in one order — a card is compared against another card, and two orders would read as two answers. */
function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
