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
export { DEFAULT_CHANNEL_REQUIREMENTS, CHART_REQUIREMENTS, requirementFor, chartKindsOf, channelsOf } from './requirements.js';
export { SENTENCES, fill, listOf } from './sentences.js';
export { resolveFacets, resolveFacet, scaleOfType } from './facets.js';
export type { FacetSource } from './facets.js';
export { BUILTIN_RULES, validateBindings, requirementFailure, refuses, ruleId } from './validate.js';
export type { ValidateInput } from './validate.js';
export { validateColumnDecls, validateEncodingRulesShape } from './shape.js';
export { fitsFor, acceptsOf } from './fits.js';
export type { FitsInput } from './fits.js';
// The same answer one step earlier — before a dashboard exists to ask.
export { whatFits, WHAT_FITS_VIEW_ID } from './whatFits.js';
export type { FitColumn, WhatFitsInput } from './whatFits.js';
// The default recommender: preferences as DATA, ordering what `whatFits` admitted.
export { RANKING_POLICY, CHANNEL_NAMES, DEFAULT_RANKING_REASON, placeIn, policyRecommender } from './recommend.js';
export type { RankingRule, Placement } from './recommend.js';
// Whole charts, proposed — `whatFits` and the recommender, composed.
export { proposeCharts, proposableKinds, OFFER_SENTENCES, PROPOSAL_LIMIT, PROPOSAL_CANDIDATES, PROPOSAL_BINDINGS } from './propose.js';
export type { ChartProposal, ChartProposals, ProposalKind, ProposeChartsInput } from './propose.js';
export { lintEncodings, pageBindings, formatProblem } from './lint.js';
export type { LintInput } from './lint.js';
export { describeRules, describeRule } from './describe.js';
export type { RuleLine } from './describe.js';
export { discreteCoercer, BUILTIN_COERCERS } from './coercers.js';
