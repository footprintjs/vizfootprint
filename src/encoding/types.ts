/**
 * The encoding plane's vocabulary (layer 4, second plane): which column may
 * sit on which visual channel, stated as DATA a def carries and one validator
 * reads. Nothing here executes; the shapes are inert (R12) and every refusal
 * they produce is a sentence.
 *
 * Three kinds of statement:
 *   - a CHANNEL REQUIREMENT — what a chart kind's channel accepts (a type, a
 *     scale, a role); the library ships one set per built-in chart kind and a
 *     def may add or override per kind;
 *   - a BUSINESS RULE — a fact about the customer's columns no chart kind can
 *     know (`ytd` and `cases` never share a chart; `value` only with `entity`);
 *   - a POLICY — what happens to an act that breaks a rule (refuse, or coerce
 *     through a named adapter) and how wide `never-together` reaches.
 */
import type { ColumnFacet, ColumnRole, ColumnScale, ColumnType } from '../data/types.js';

// ── Channel classes ──────────────────────────────────────────────────────────

/**
 * A channel CLASS names several channels at once so a rule can say "never on
 * a magnitude" without listing x, y, size, r, radius and theta by hand.
 */
export type ChannelClass = 'magnitude' | 'category';

/**
 * The visual channels that carry a MAGNITUDE — position along an axis, size,
 * radius, angle. A declared absence column may never bind to one of these:
 * "unavailable" on an axis renders as a low number and tells the reader the
 * wrong thing with a straight face. One list, read by every door.
 */
export const MAGNITUDE_CHANNELS: ReadonlySet<string> = new Set(['x', 'y', 'size', 'r', 'radius', 'theta']);

/** The channels that carry a CATEGORY — a hue, a shape, a panel, a row of a table. */
export const CATEGORY_CHANNELS: ReadonlySet<string> = new Set(['color', 'shape', 'category', 'detail', 'facet', 'column', 'row', 'region']);

export const CHANNEL_CLASSES: Readonly<Record<ChannelClass, ReadonlySet<string>>> = Object.freeze({
  magnitude: MAGNITUDE_CHANNELS,
  category: CATEGORY_CHANNELS,
});

// ── Channel requirements ─────────────────────────────────────────────────────

/**
 * What one channel of one chart kind accepts. Every listed constraint must
 * hold; an absent constraint is "anything". A column whose facet cannot prove
 * a constraint (type `unknown`, no declared role) is NOT refused by that
 * constraint — the validator refuses on evidence, never on ignorance.
 */
export interface ChannelRequirement {
  readonly channel: string;
  /** Column types the channel accepts. */
  readonly accepts?: readonly ColumnType[];
  /** The scale the channel needs (a bar's category axis is discrete; a line's x is continuous). */
  readonly scale?: ColumnScale;
  /** Roles the channel accepts (only checked when the column DECLARED a role). */
  readonly roles?: readonly ColumnRole[];
  /** Roles the channel refuses (only checked when the column declared a role). */
  readonly notRoles?: readonly ColumnRole[];
  /** A sentence template overriding the built-in one. Slots: {column} {channel} {view} {type} {scale} {role} {chart}. */
  readonly sentence?: string;
}

/** chartKind → its channel requirements. */
export type ChannelRequirements = Readonly<Record<string, readonly ChannelRequirement[]>>;

// ── Business rules ───────────────────────────────────────────────────────────

/** How far a two-column rule reaches: one chart, or every chart on the page. */
export type RuleScope = 'view' | 'dashboard';

/** `column` never binds to `channels` (or to every channel of `class`). Names a column OR a role, never both. */
export interface NeverOnRule {
  readonly rule: 'never-on';
  readonly id?: string;
  readonly column?: string;
  readonly role?: ColumnRole;
  readonly channels?: readonly string[];
  readonly class?: ChannelClass;
  /** Slots: {column} {channel} {view} {role} {chart}. */
  readonly sentence?: string;
}

/** The two columns never appear together — on one chart (`view`) or anywhere on the page (`dashboard`, the default). */
export interface NeverTogetherRule {
  readonly rule: 'never-together';
  readonly id?: string;
  readonly columns: readonly [string, string];
  readonly scope?: RuleScope;
  /** Slots: {column} {other} {view} {chart}. */
  readonly sentence?: string;
}

/** `column` may be bound only while `companion` is also bound, within `scope` (default `view`). */
export interface OnlyWithRule {
  readonly rule: 'only-with';
  readonly id?: string;
  readonly column: string;
  readonly companion: string;
  readonly scope?: RuleScope;
  /** Slots: {column} {companion} {view} {chart}. */
  readonly sentence?: string;
}

export type BusinessRule = NeverOnRule | NeverTogetherRule | OnlyWithRule;

export const RULE_KINDS: readonly BusinessRule['rule'][] = ['never-on', 'never-together', 'only-with'];
export const RULE_SCOPES: readonly RuleScope[] = ['view', 'dashboard'];

// ── Policy ───────────────────────────────────────────────────────────────────

/** The data half of the policy — what a def may state. The ports (explainer, coercers, recommender) are passed at build. */
export interface EncodingPolicy {
  /** `refuse` (the default) or the NAME of a coercer passed at build. */
  readonly onInvalid?: 'refuse' | string;
  /** The default scope for rules that leave theirs unstated. Default `dashboard`. */
  readonly ruleScope?: RuleScope;
}

/** The whole rule set a def carries under `encodingRules` — inert data. */
export interface EncodingRules extends EncodingPolicy {
  /** Per chart kind: added to (or, per channel, overriding) the built-in requirements. */
  readonly channels?: ChannelRequirements;
  readonly rules?: readonly BusinessRule[];
}

// ── Problems ─────────────────────────────────────────────────────────────────

/** Where a problem was found and what it refuses (or what was coerced instead). */
export interface EncodingProblem {
  /** The rule that fired: `channel:<chart>.<channel>` for a requirement, the rule's `id` or `<kind>#<index>` for a business rule. */
  readonly rule: string;
  readonly viewId: string;
  readonly channel: string;
  readonly field: string;
  /** The template sentence — ALWAYS present, whatever explainer runs. */
  readonly sentence: string;
  /** Prose an explainer port added on top of the template, when one was passed at build. */
  readonly explained?: string;
  /** `refused` under the refuse policy; `coerced` when a coercer took the binding instead. */
  readonly severity: 'refused' | 'coerced';
  /** For a coercion: the facet the coercer produced. */
  readonly coercedTo?: ColumnFacet;
}

// ── Ports (passed at build, never on the def) ────────────────────────────────

/** Turns a column that does not fit a channel into one that does — or declines with null. */
export interface Coercer {
  readonly name: string;
  coerce(facet: ColumnFacet, requirement: ChannelRequirement): ColumnFacet | null;
}

/** Adds prose to a problem. The template sentence stays on the problem regardless. */
export interface Explainer {
  explain(problem: EncodingProblem): string;
}

/** One column's fitness for one channel, as the picker and the agent read it. */
export interface Fit {
  readonly field: string;
  readonly ok: boolean;
  /** The sentence when `ok` is false. */
  readonly because?: string;
}

/** Ranks the columns that FIT a channel (soft preferences). Never sees the refused ones. */
export interface Recommender {
  rank(channel: string, fits: readonly Fit[], facets: readonly ColumnFacet[]): readonly Fit[];
}

export interface EncodingPorts {
  readonly explainer?: Explainer;
  readonly coercers?: readonly Coercer[];
  readonly recommender?: Recommender;
}

// ── The view surface the validator reads (structurally equal to the def's ViewEncodingDecl) ──

export interface EncodingSurface {
  readonly viewId: string;
  readonly chartKind: string;
  readonly channels: readonly string[];
  readonly initial?: Readonly<Record<string, string>>;
}

/** channel → field, one view's current bindings. */
export type Bindings = Readonly<Record<string, string>>;

// ── What a def may state about one column (`DataSourceDef.columns[field]`) ──

export interface ColumnDecl {
  /** What the column IS, when the provider's inferred type is not the truth (an ISO-string column that is a date). */
  readonly type?: ColumnType;
  readonly role?: ColumnRole;
  readonly scale?: ColumnScale;
  /** A display label, echoed verbatim. */
  readonly label?: string;
}

export const COLUMN_ROLES: readonly ColumnRole[] = ['identifier', 'dimension', 'measure', 'absence'];
export const COLUMN_SCALES: readonly ColumnScale[] = ['discrete', 'continuous'];
