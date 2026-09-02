/**
 * The ONE validator behind the three doors — build (throw), dispatch (refuse
 * as a gap), lint (list). It reads a view's RESULTING bindings, so a swap or a
 * two-channel change is judged as a whole, and it refuses on evidence only: a
 * column whose facet cannot prove a constraint is not refused by it.
 *
 * Two families: per-binding SHAPE checks (is it a column; does the channel's
 * requirement hold — with a coercer given a chance under the coerce policy)
 * and the BUSINESS RULES (the built-in absence law first, then the def's, in
 * declared order). Rule problems are reported before shape problems: a law
 * is the real reason, a type mismatch beside it is incidental. Coercion
 * never applies to a business rule: a rule is a fact about the columns, not
 * about their shape.
 */
import type { ColumnFacet } from '../data/types.js';
import { requirementFor } from './requirements.js';
import { SENTENCES, fill, listOf } from './sentences.js';
import { CHANNEL_CLASSES } from './types.js';
import type { Bindings, BusinessRule, ChannelRequirement, Coercer, EncodingPorts, EncodingProblem, EncodingRules, EncodingSurface, RuleScope } from './types.js';

/** The law every def inherits: the absence column never carries a magnitude. */
export const BUILTIN_RULES: readonly BusinessRule[] = [
  {
    rule: 'never-on',
    id: 'absence-never-magnitude',
    role: 'absence',
    class: 'magnitude',
    sentence: '"{column}" is the declared absence column — it cannot bind to the magnitude channel "{channel}"; absence is a category, never a magnitude',
  },
];

export interface ValidateInput {
  readonly view: EncodingSurface;
  /** The bindings AS THEY WOULD BE after the act (initial merged with the change). */
  readonly bindings: Bindings;
  readonly facets: readonly ColumnFacet[];
  /** The other views' current bindings, for rules with dashboard scope. */
  readonly others?: Readonly<Record<string, Bindings>>;
  readonly rules?: EncodingRules;
  readonly ports?: EncodingPorts;
  /**
   * The channels this act changed. Problems are reported for those; a
   * pre-existing violation on an untouched channel does not refuse an
   * unrelated act. Absent = judge every bound channel (lint).
   */
  readonly changed?: readonly string[];
}

/** The id a def rule is reported under: its own, or `<kind>#<index>` in the def's list. */
export function ruleId(rule: BusinessRule, index: number): string {
  return rule.id ?? `${rule.rule}#${index}`;
}

export function validateBindings(input: ValidateInput): EncodingProblem[] {
  const { view, bindings, facets } = input;
  const rules = input.rules ?? {};
  const byField = new Map(facets.map((f) => [f.field, f] as const));
  const changed = new Set(input.changed ?? Object.keys(bindings));
  const coercers = coercersFor(rules.onInvalid, input.ports?.coercers);
  const shape: EncodingProblem[] = []; // requirement + column problems
  const problems: EncodingProblem[] = []; // business-rule problems — reported FIRST: a law is the real reason, a shape mismatch is incidental
  const at = (rule: string, channel: string, field: string, sentence: string, extra: Partial<EncodingProblem> = {}): EncodingProblem => ({
    rule,
    viewId: view.viewId,
    channel,
    field,
    sentence,
    severity: 'refused',
    ...extra,
  });

  // 1. each changed binding: a real column, and the channel's requirement holds (or a coercer makes it hold)
  for (const channel of changed) {
    const field = bindings[channel];
    if (field === undefined) continue;
    const facet = byField.get(field);
    if (facet === undefined) {
      shape.push(at('column', channel, field, fill(SENTENCES.notAColumn, { column: field })));
      continue;
    }
    const req = requirementFor(view.chartKind, channel, rules.channels);
    if (req === undefined) continue;
    const failure = requirementFailure(facet, req, view, channel);
    if (failure === undefined) continue;
    const id = `channel:${view.chartKind}.${channel}`;
    const coerced = coercers.map((c) => c.coerce(facet, req)).find((f): f is ColumnFacet => f !== null && requirementFailure(f, req, view, channel) === undefined);
    shape.push(coerced !== undefined ? at(id, channel, field, failure, { severity: 'coerced', coercedTo: coerced }) : at(id, channel, field, failure));
  }

  // 2. business rules — the built-in law first, then the def's in declared order
  const defRules = rules.rules ?? [];
  const all: readonly { readonly rule: BusinessRule; readonly id: string }[] = [
    ...BUILTIN_RULES.map((rule) => ({ rule, id: rule.id! })),
    ...defRules.map((rule, i) => ({ rule, id: ruleId(rule, i) })),
  ];
  const defaultScope: RuleScope = rules.ruleScope ?? 'dashboard';
  const channelOf = (field: string): string | undefined => Object.keys(bindings).find((ch) => bindings[ch] === field);
  const boundElsewhere = (field: string): boolean => Object.values(input.others ?? {}).some((b) => Object.values(b).includes(field));
  const slots = { view: view.viewId, chart: view.chartKind };

  for (const { rule, id } of all) {
    switch (rule.rule) {
      case 'never-on': {
        const forbidden = rule.channels !== undefined ? new Set(rule.channels) : CHANNEL_CLASSES[rule.class!];
        for (const channel of changed) {
          const field = bindings[channel];
          if (field === undefined || !forbidden.has(channel)) continue;
          const facet = byField.get(field);
          const hit = rule.column !== undefined ? rule.column === field : facet?.role !== undefined && facet.role === rule.role;
          if (!hit) continue;
          const template = rule.sentence ?? (rule.role !== undefined ? SENTENCES.neverOnRole : SENTENCES.neverOn);
          problems.push(at(id, channel, field, fill(template, { ...slots, column: field, channel, role: facet?.role })));
        }
        break;
      }
      case 'never-together': {
        const scope = rule.scope ?? defaultScope;
        const [a, b] = rule.columns;
        const chA = channelOf(a);
        const chB = channelOf(b);
        const template = rule.sentence ?? (scope === 'view' ? SENTENCES.neverTogetherView : SENTENCES.neverTogetherDashboard);
        // report on the changed side; the other column is the one it collides with.
        // When BOTH sides changed (a set, or lint), one problem names the pair once.
        const bothChanged = chA !== undefined && chB !== undefined && changed.has(chA) && changed.has(chB);
        for (const [column, other, ch] of [
          [a, b, chA],
          [b, a, chB],
        ] as const) {
          if (ch === undefined || !changed.has(ch)) continue;
          if (bothChanged && column === b) continue;
          const otherHere = channelOf(other) !== undefined;
          const collides = scope === 'view' ? otherHere : otherHere || boundElsewhere(other);
          if (collides) problems.push(at(id, ch, column, fill(template, { ...slots, column, other })));
        }
        break;
      }
      case 'only-with': {
        // judged on the RESULT, whichever channel the act touched: rebinding the
        // companion's channel away breaks the rule as surely as binding the column
        // without it (a violation can never pre-exist — build and dispatch both refuse it)
        const scope = rule.scope ?? 'view';
        const ch = channelOf(rule.column);
        if (ch === undefined) break;
        const companionHere = channelOf(rule.companion) !== undefined;
        const present = scope === 'view' ? companionHere : companionHere || boundElsewhere(rule.companion);
        if (present) break;
        const template = rule.sentence ?? (scope === 'view' ? SENTENCES.onlyWithView : SENTENCES.onlyWithDashboard);
        problems.push(at(id, ch, rule.column, fill(template, { ...slots, column: rule.column, companion: rule.companion })));
        break;
      }
    }
  }

  // 3. the explainer adds prose; the template sentence stays
  const explainer = input.ports?.explainer;
  const out = [...problems, ...shape];
  return explainer === undefined ? out : out.map((p) => ({ ...p, explained: explainer.explain(p) }));
}

/** The sentence a requirement refuses a facet with, or undefined when the facet passes (or cannot be judged). */
export function requirementFailure(facet: ColumnFacet, req: ChannelRequirement, view: EncodingSurface, channel: string): string | undefined {
  const slots = {
    column: facet.field,
    channel,
    view: view.viewId,
    chart: view.chartKind,
    type: facet.type,
    scale: facet.scale,
    role: facet.role,
    accepts: req.accepts !== undefined ? listOf(req.accepts) : undefined,
    needScale: req.scale,
    roles: req.roles !== undefined ? listOf(req.roles) : undefined,
  };
  const say = (template: string): string => fill(req.sentence ?? template, slots);
  if (req.accepts !== undefined && facet.type !== 'unknown' && !req.accepts.includes(facet.type)) return say(SENTENCES.accepts);
  if (req.scale !== undefined && facet.scale !== undefined && facet.scale !== req.scale) return say(SENTENCES.scale);
  if (req.roles !== undefined && facet.role !== undefined && !req.roles.includes(facet.role)) return say(SENTENCES.roles);
  if (req.notRoles !== undefined && facet.role !== undefined && req.notRoles.includes(facet.role)) return say(SENTENCES.notRoles);
  return undefined;
}

/** The coercers the policy allows: none under `refuse`; the named one (by name) otherwise. */
function coercersFor(onInvalid: string | undefined, available: readonly Coercer[] | undefined): readonly Coercer[] {
  if (onInvalid === undefined || onInvalid === 'refuse') return [];
  return (available ?? []).filter((c) => c.name === onInvalid);
}

/** True when any problem refuses (a coerced problem lets the act land). */
export function refuses(problems: readonly EncodingProblem[]): boolean {
  return problems.some((p) => p.severity === 'refused');
}
