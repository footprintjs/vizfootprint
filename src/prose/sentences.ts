/** The prose plane's refusal sentences — templates beside the rules, the same words at every door. */
export const PROSE_SENTENCES = Object.freeze({
  slot: '"{slot}" is not a prose slot — the slots are {slots}',
  record: 'prose for "{view}".{slot} must be a record { text, author, levels?, basis?, role? }, never a bare string',
  text: '"{view}".{slot} needs text — only a derived slot leaves the words to the library',
  textType: '"{view}".{slot}.text must be a string',
  derivedText: '"{view}".{slot} is derived — the library writes the construction line; leave text out',
  derivedSurface: '"{view}".{slot} is derived, but "{view}" declares no encoding surface — there is nothing to derive from',
  dashboardDerived: 'the dashboard\'s {slot} cannot be derived — the dashboard binds nothing; write the words',
  dashboardEncodings: 'the dashboard\'s {slot} states encodings in its basis, but the dashboard binds nothing — state filters, columns or an analysis instead',
  noteDerived: 'a note\'s {slot} cannot be derived — a note binds nothing; write the words',
  noteEncodings: 'a note\'s {slot} states encodings in its basis, but a note binds nothing — state filters, columns or an analysis instead',
  levels: '"{view}".{slot}.levels must be a list of {levels}',
  author: '"{view}".{slot}.author must be a record whose kind is one of {kinds}',
  authorField: '"{view}".{slot}.author.{field} must be a string',
  agentBasis: '"{view}".{slot} was written by an agent and states no basis — without one, a model\'s words are indistinguishable from stated fact',
  agentCausal: '"{view}".{slot} claims a cause, which the data cannot carry — an agent may state construction, statistics, and trends, never why',
  basis: '"{view}".{slot}.basis must be a record { encodings?, filters?, columns?, analysisId?, atCommit? }',
  basisColumns: '"{view}".{slot}.basis.columns must be a list of column names',
  basisFilters: '"{view}".{slot}.basis.filters must be a record keyed by view (the live selections as a basis states them — copy whats_here.filters; {} for none), never a list',
  basisColumn: '"{view}".{slot} names a column that is not on this branch: "{column}"',
  basisAnalysis: '"{view}".{slot} quotes an analysis that is not declared: "{analysisId}"',
  role: '"{view}".{slot}.role must be informative or decorative',
  agentTrend: '"{view}".{slot} states a trend an agent perceived — a trend is proposed for a person to accept, never stated outright',
  noProposal: '"{view}".{slot} has no open proposal "{proposal}" on this path',
  declineReason: 'declining "{view}".{slot} needs a reason — a refusal without words is a silence',
  refs: '"{view}".{slot}.refs must be a list of { span: [start, end], commit? | beat?, label? }',
  refSpan: '"{view}".{slot}.refs[{index}] spans [{start}, {end}) but the text has {length} characters',
  refTarget: '"{view}".{slot}.refs[{index}] must name exactly one of commit, beat, saved',
  refCommit: '"{view}".{slot}.refs[{index}] points at a commit the log does not hold: "{commit}"',
  refBeat: '"{view}".{slot}.refs[{index}] points at a beat that was never named: "{beat}"',
  refSaved: '"{view}".{slot}.refs[{index}] points at a saved selection that does not exist: "{saved}"',
  view: 'prose[{index}].viewId "{view}" is not a declared view (or "dashboard", the cockpit itself)',
  repeat: 'prose[{index}] repeats view "{view}" — one prose entry per view',
});

export function fillProse(template: string, slots: Readonly<Record<string, string | undefined>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => slots[key] ?? whole);
}
