/**
 * The rules as sentences — what the Grammar panel lists and what an agent
 * reads to know the house laws before it acts. Built-in first, then the
 * def's in declared order.
 */
import { SENTENCES, fill } from './sentences.js';
import { CHANNEL_CLASSES } from './types.js';
import { BUILTIN_RULES, ruleId } from './validate.js';
import type { BusinessRule, EncodingRules, RuleScope } from './types.js';

export interface RuleLine {
  readonly id: string;
  readonly builtIn: boolean;
  readonly sentence: string;
}

export function describeRules(rules: EncodingRules = {}): RuleLine[] {
  const defaultScope: RuleScope = rules.ruleScope ?? 'dashboard';
  return [
    ...BUILTIN_RULES.map((rule) => ({ id: rule.id!, builtIn: true, sentence: describeRule(rule, defaultScope) })),
    ...(rules.rules ?? []).map((rule, i) => ({ id: ruleId(rule, i), builtIn: false, sentence: describeRule(rule, defaultScope) })),
  ];
}

export function describeRule(rule: BusinessRule, defaultScope: RuleScope = 'dashboard'): string {
  switch (rule.rule) {
    case 'never-on': {
      const channels = rule.channels !== undefined ? rule.channels.join(', ') : `any ${rule.class} channel (${[...CHANNEL_CLASSES[rule.class!]].join(', ')})`;
      const column = rule.column ?? `a column whose role is ${rule.role}`;
      return fill(rule.sentence ?? (rule.role !== undefined ? SENTENCES.neverOnRole : SENTENCES.neverOn), { column, channel: channels, role: rule.role });
    }
    case 'never-together': {
      const scope = rule.scope ?? defaultScope;
      return fill(rule.sentence ?? (scope === 'view' ? SENTENCES.neverTogetherView : SENTENCES.neverTogetherDashboard), { column: rule.columns[0], other: rule.columns[1] });
    }
    case 'only-with': {
      const scope = rule.scope ?? 'view';
      return fill(rule.sentence ?? (scope === 'view' ? SENTENCES.onlyWithView : SENTENCES.onlyWithDashboard), { column: rule.column, companion: rule.companion });
    }
  }
}
