/** The same declared meaning is used by operation discovery and result context. */
export const RANK_OPERATION = Object.freeze({
  id: 'rank' as const,
  title: 'Rank existing numeric observations',
  description: 'Order existing numeric observations by one declared measure, with complete source keys, deterministic ties and separate known/missing population counts. Does not aggregate or recompute percentiles.',
});
export const RANK_NOTES = Object.freeze([
  RANK_OPERATION.description,
  'Rows describe the declared input grain, not inferred distinct entities. The population basis is explicitly provider-snapshot or native analysis-input; neither establishes complete estate coverage.',
  'The measure retains its declared meaning and unit. Ranking existing aggregated measurements does not recompute their underlying statistics or change their weighting.',
  'Zero is known. Null or undefined measurements are excluded and counted as missing; invalid values refuse. Complete keys identify supporting records only within the declared source version and table.',
  'Positions are ordinal. Equal values use complete keys ascending; the top-N boundary may split a tie. No source order, dense rank or all-ties inclusion is implied.',
  'ranking.shown is the number saved in this top-N result; ranking.total is the known selected population; ranking.omitted is total minus shown; ranking.complete means all known selected measurements were saved.',
  'rowPage.total is the number saved in this result. rowPage.omitted counts every saved row outside this page, including previous pages; nextOffset addresses this saved result, not the source population.',
  'This is a bounded projection of a trusted computed receipt, not a source rescan or reference authentication. The host owns result lookup, immutable source retention and authorization. An observation does not establish causation.',
]);
