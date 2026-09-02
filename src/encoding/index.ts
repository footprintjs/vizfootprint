/**
 * vizfootprint/encoding — the encoding plane: which column may sit on which
 * channel, as data one validator reads behind three doors (build, dispatch,
 * lint). See ./README.md.
 */
export {
  MAGNITUDE_CHANNELS,
  CATEGORY_CHANNELS,
  CHANNEL_CLASSES,
  RULE_KINDS,
  RULE_SCOPES,
  COLUMN_ROLES,
  COLUMN_SCALES,
} from './types.js';
export type {
  ChannelClass,
  ChannelRequirement,
  ChannelRequirements,
  RuleScope,
  NeverOnRule,
  NeverTogetherRule,
  OnlyWithRule,
  BusinessRule,
  EncodingPolicy,
  EncodingRules,
  EncodingProblem,
  Coercer,
  Explainer,
  Fit,
  Recommender,
  EncodingPorts,
  EncodingSurface,
  Bindings,
  ColumnDecl,
} from './types.js';
export { DEFAULT_CHANNEL_REQUIREMENTS, CHART_REQUIREMENTS, requirementFor } from './requirements.js';
export { SENTENCES, fill, listOf } from './sentences.js';
export { resolveFacets, resolveFacet, scaleOfType } from './facets.js';
export type { FacetSource } from './facets.js';
export { BUILTIN_RULES, validateBindings, requirementFailure, refuses, ruleId } from './validate.js';
export type { ValidateInput } from './validate.js';
export { validateColumnDecls, validateEncodingRulesShape } from './shape.js';
export { fitsFor, acceptsOf } from './fits.js';
export type { FitsInput } from './fits.js';
export { lintEncodings, formatProblem } from './lint.js';
export type { LintInput } from './lint.js';
export { describeRules, describeRule } from './describe.js';
export type { RuleLine } from './describe.js';
export { discreteCoercer, BUILTIN_COERCERS } from './coercers.js';
