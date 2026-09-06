/**
 * THE FOUR STEPS, JUDGED WITHOUT A SCREEN.
 *
 * Every claim `make` makes about authoring is made here, against the real
 * library: that the ceiling is stated before a file is chosen, that a column is
 * declared rather than demoted, that a misfit comes back in the ENCODING
 * PLANE's own sentence rather than one written in this package, and that what
 * the assembler produces is a definition that survives JSON, parses, builds and
 * answers a select.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, parseDashboardDef } from 'vizfootprint/def';
import {
  MAKE_CEILING_SENTENCE,
  MAKE_CHART_KINDS,
  MAKE_PROPOSALS,
  MAKE_PROPOSAL_KINDS,
  MAKE_STEPS,
  MAKE_TABLE,
  MEASURED_BREAKS_ROWS,
  MEASURED_FINE_ROWS,
  absenceOf,
  analysisOf,
  assembleDef,
  ceilingVerdict,
  declaredColumn,
  emptyDraft,
  fitColumns,
  fitsForView,
  judgeStep,
  misfit,
  newView,
  parseStates,
  proposalsFor,
  readTable,
  seedColumns,
  sniffedTypes,
  viewFromProposal,
} from './steps.js';
import { BARS, LINE, SALES_CSV, salesDraft } from './make.fixture.js';
import type { MakeReading } from './types.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

describe('the ceiling — stated at step one, before anything else', () => {
  it('says what the engine was measured at, in a sentence, with no file in hand', () => {
    expect(MAKE_CEILING_SENTENCE).toContain('ninety thousand');
    expect(MAKE_CEILING_SENTENCE).toContain('fifty-millisecond');
  });

  it('places a particular file against it — and never refuses one', () => {
    expect(ceilingVerdict(6).level).toBe('fine');
    expect(ceilingVerdict(MEASURED_FINE_ROWS).level).toBe('fine');
    expect(ceilingVerdict(MEASURED_FINE_ROWS + 1)).toMatchObject({ level: 'watch' });
    expect(ceilingVerdict(MEASURED_FINE_ROWS + 1).sentence).toContain('Gestures will be slower');
    expect(ceilingVerdict(MEASURED_BREAKS_ROWS).level).toBe('over');
    expect(ceilingVerdict(MEASURED_BREAKS_ROWS).sentence).toContain('1,000,000 rows');
  });
});

describe('step 1 — bring data', () => {
  it('describes what arrived: the columns, what they read as, and how many rows', () => {
    const read = readTable(SALES_CSV);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.reading.rows).toBe(6);
    expect(read.reading.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['region:string', 'quarter:string', 'sales:number', 'report_state:string']);
    // the blanks are an absence, not a fifth value
    expect(read.reading.columns[2]?.extent).toEqual([60, 150]);
  });

  it('refuses the four things that are not a table, each in a sentence', () => {
    expect(readTable('   ')).toEqual({ ok: false, refusals: ['there is nothing to read yet — paste a CSV, or choose a file'] });
    const noRows = readTable('a,b\n');
    expect(noRows.ok).toBe(false);
    if (!noRows.ok) expect(noRows.refusals[0]).toContain('a header and no rows');
    const twice = readTable('a,a\n1,2\n');
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.refusals[0]).toContain('is in the header twice');
  });

  it('a header cell with nothing in it is refused: a column nobody can name is a column nobody can bind', () => {
    const blank = readTable(',b\n1,2\n');
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.refusals.join(' ')).toContain('has no name');
  });

  it('seeds the declarations with the SNIFF and nothing else — no role is invented', () => {
    const read = readTable(SALES_CSV);
    if (!read.ok) throw new Error('the fixture must read');
    expect(seedColumns(read.reading)).toEqual([
      { name: 'region', type: 'string' },
      { name: 'quarter', type: 'string' },
      { name: 'sales', type: 'number' },
      { name: 'report_state', type: 'string' },
    ]);
    // a column that held nothing at all reads as `unknown`, and that is not a declaration either
    const empty = readTable('a,b\n1,\n2,\n');
    if (!empty.ok) throw new Error('two rows are rows');
    expect(seedColumns(empty.reading)).toEqual([{ name: 'a', type: 'number' }, { name: 'b' }]);
  });

  it('will not begin step two until the table has been read', () => {
    const draft = emptyDraft();
    expect(draft).toMatchObject({ table: MAKE_TABLE, csv: '', columns: [], absence: null, views: [] });
    expect(judgeStep('data', draft, null)).toEqual({ ok: false, refusals: ['there is nothing to read yet — paste a CSV, or choose a file'] });

    const pasted = { ...draft, csv: SALES_CSV };
    const verdict = judgeStep('data', pasted, null);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusals[0]).toContain('has not been read yet');

    const read = readTable(SALES_CSV);
    if (!read.ok) throw new Error('the fixture must read');
    expect(judgeStep('data', pasted, read.reading)).toEqual({ ok: true });
  });

  it('says what each column read as, and says nothing before anything has been read', () => {
    const read = readTable(SALES_CSV);
    if (!read.ok) throw new Error('the fixture must read');
    expect(sniffedTypes(read.reading)['quarter']).toBe('string');
    expect(sniffedTypes(null)).toEqual({});
  });
});

describe('step 2 — check and describe', () => {
  it('refuses a column nobody has given a role, BY NAME, rather than choosing one', () => {
    const draft = salesDraft({ columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number', role: 'measure' }], views: [] });
    const verdict = judgeStep('columns', draft, null);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toContain('"region" has no declared role');
    expect(verdict.refusals[0]).toContain('a guess the dashboard then repeats');
  });

  it('does not ask for a role on the ABSENCE column — that one is derived from the vocabulary', () => {
    expect(judgeStep('columns', salesDraft(), null)).toEqual({ ok: true });
  });

  it('passes the LIBRARY\'s own refusal through verbatim when a declaration is illegal', () => {
    const verdict = judgeStep('columns', salesDraft({ absence: { field: 'report_state', states: ['present', 'unavailable'] } }), null);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusals.join('\n')).toContain('must include "unknown" — a source that cannot tell which silence it saw needs a word for that');
  });

  it('an absence column that has been given a role of its own is the library\'s refusal, not this wizard\'s', () => {
    const draft = salesDraft({ columns: [{ name: 'report_state', type: 'string', role: 'dimension' }], absence: null });
    const verdict = judgeStep('columns', { ...draft, absence: { field: 'report_state', states: ['present', 'unknown'] }, columns: [{ name: 'report_state', role: 'dimension' }] }, null);
    // the wizard leaves the absence column out of `columns` entirely, so there is nothing to refuse
    expect(verdict).toEqual({ ok: true });
  });

  it('an empty slot is not a declaration: `declaredColumn` drops what nobody said', () => {
    expect(declaredColumn({ name: 'a', type: 'number', role: 'measure', scale: 'continuous', label: 'A' })).toEqual({ name: 'a', type: 'number', role: 'measure', scale: 'continuous', label: 'A' });
    expect(declaredColumn({ name: 'a', label: '' })).toEqual({ name: 'a' });
    expect(declaredColumn({ name: 'a' })).toEqual({ name: 'a' });
  });

  it('the vocabulary is what a person typed, trimmed — and no column named means no absence at all', () => {
    expect(parseStates(' present , unavailable ,, unknown ')).toEqual(['present', 'unavailable', 'unknown']);
    expect(absenceOf('', 'present, unknown')).toBeNull();
    expect(absenceOf('flag', 'present, unknown')).toEqual({ field: 'flag', states: ['present', 'unknown'] });
  });
});

describe('step 3 — visualize', () => {
  it('says per channel what fits and, for what does not, WHY — in the encoding plane\'s own words', () => {
    const draft = salesDraft();
    const fits = fitsForView(draft, LINE);
    // a line's x takes a magnitude OR a date, so the number column fits it too — the plane's rule, not this wizard's
    expect(fits['x']?.filter((f) => f.ok).map((f) => f.field)).toEqual(['quarter', 'sales']);
    const refusedX = fits['x']?.find((f) => f.field === 'region');
    expect(refusedX?.ok).toBe(false);
    expect(refusedX?.because).toContain('"region"');

    // the built-in absence law, reached through the same door
    const onY = fits['y']?.find((f) => f.field === 'report_state');
    expect(onY?.because).toContain('absence is a category, never a magnitude');
  });

  it('a misfit is one sentence, and a column this table has not got is another', () => {
    const draft = salesDraft();
    expect(misfit(draft, LINE, 'y', 'sales')).toBeNull();
    expect(misfit(draft, LINE, 'y', 'region')).toContain('"region"');
    expect(misfit(draft, LINE, 'y', 'nothing_at_all')).toBe('"nothing_at_all" is not a column of this table, so nothing can be put on the y channel from it');
    // and a channel the KIND has not got is its own answer, not a column's
    expect(misfit(draft, BARS, 'y', 'sales')).toBe('a bar has no y channel, so nothing can sit on it');
  });

  it('refuses a dashboard with no charts, an unnamed chart, two of one name, and an empty channel', () => {
    const none = judgeStep('views', salesDraft({ views: [] }), null);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.refusals[0]).toContain('no charts yet');

    const unnamed = judgeStep('views', salesDraft({ views: [{ ...BARS, id: '  ' }] }), null);
    expect(unnamed.ok).toBe(false);
    if (!unnamed.ok) expect(unnamed.refusals.join('\n')).toContain('a chart needs a name of its own');

    const twice = judgeStep('views', salesDraft({ views: [BARS, { ...LINE, id: BARS.id }] }), null);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.refusals.join('\n')).toContain('two charts are both called "regions"');

    const unbound = judgeStep('views', salesDraft({ views: [{ ...BARS, bindings: {} }] }), null);
    expect(unbound.ok).toBe(false);
    if (!unbound.ok) expect(unbound.refusals[0]).toContain('has nothing on its category channel');
  });

  it('refuses a MISFIT binding in a sentence, at this step', () => {
    const verdict = judgeStep('views', salesDraft({ views: [{ ...LINE, bindings: { x: 'region', y: 'sales' } }] }), null);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusals[0]).toContain('"region"');
  });

  it('passes a whole, well-formed step three', () => {
    expect(judgeStep('views', salesDraft(), null)).toEqual({ ok: true });
  });

  it('a table has no channels to bind, so it is only ever refused for its name', () => {
    expect(MAKE_CHART_KINDS.table.channels).toEqual([]);
    expect(judgeStep('views', salesDraft({ views: [newView('table', 1)] }), null)).toEqual({ ok: true });
    expect(newView('bar', 2)).toEqual({ id: 'bar2', label: '', chartKind: 'bar', bindings: {} });
  });

  it('the analysis is the def\'s builtin RECORD, with the blanks left out and the counts made numbers', () => {
    expect(analysisOf('', { by: 'region' })).toBeNull();
    expect(analysisOf('groupBy', { by: 'region', measure: 'sales' })).toEqual({ id: expect.any(String), decl: { builtin: 'groupBy', by: 'region', measure: 'sales' } });
    expect(analysisOf('clustering', { column: 'sales', k: '3' })?.decl).toEqual({ builtin: 'clustering', column: 'sales', k: 3 });
    expect(analysisOf('regression', { x: 'sales', y: 'sales', minPoints: '' })?.decl).toEqual({ builtin: 'regression', x: 'sales', y: 'sales' });
  });

  it('there is nothing after the desk to judge', () => {
    expect(MAKE_STEPS).toEqual(['data', 'columns', 'views', 'desk']);
    expect(judgeStep('desk', emptyDraft(), null)).toEqual({ ok: true });
  });
});

describe('the assembler — what comes out is a DEFINITION, and it is data', () => {
  it('declares the table, the columns, the absence vocabulary, the views and the words', () => {
    const def = assembleDef(salesDraft());
    expect(def.data[MAKE_TABLE]?.csv).toBe(SALES_CSV);
    expect(def.data[MAKE_TABLE]?.absence).toEqual({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] });
    // the absence column is NOT in `columns`: its role is derived, and declaring one would be refused
    expect(Object.keys(def.data[MAKE_TABLE]?.columns ?? {})).toEqual(['region', 'quarter', 'sales']);
    expect(def.data[MAKE_TABLE]?.columns?.['region']).toEqual({ type: 'string', role: 'dimension', label: 'the region' });
    expect(Object.keys(def.actors)).toEqual(['regions', 'quarters']);
    expect(def.encodings?.[1]).toEqual({ viewId: 'quarters', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'quarter', y: 'sales' } });
    expect(def.prose?.[0]?.slots.title?.text).toBe('Sales, quarter by quarter');
    expect(def.defaultTable).toBe(MAKE_TABLE);
  });

  it('leaves out what nobody wrote: no words, no analysis, no column declarations at all', () => {
    const bare = assembleDef(salesDraft({ title: ' ', caption: '', columns: [{ name: 'report_state' }], views: [{ ...BARS, label: '  ' }] }));
    expect(bare.prose).toBeUndefined();
    expect(bare.analyses).toBeUndefined();
    expect(bare.data[MAKE_TABLE]?.columns).toBeUndefined();
    expect(bare.actors['regions']).toEqual({ actor: 'user' });

    const captionOnly = assembleDef(salesDraft({ title: '' }));
    expect(Object.keys(captionOnly.prose?.[0]?.slots ?? {})).toEqual(['caption']);
  });

  it('carries a declared SCALE, and leaves out a column nobody said anything about at all', () => {
    const def = assembleDef(
      salesDraft({
        absence: null,
        columns: [
          { name: 'region', role: 'dimension', scale: 'discrete' },
          { name: 'quarter' }, // read, kept, and declared nothing — so it declares nothing
        ],
      }),
    );
    expect(def.data[MAKE_TABLE]?.columns).toEqual({ region: { role: 'dimension', scale: 'discrete' } });
  });

  it('a table with no absence declares its columns whole', () => {
    const def = assembleDef(salesDraft({ absence: null }));
    expect(Object.keys(def.data[MAKE_TABLE]?.columns ?? {})).toEqual(['region', 'quarter', 'sales', 'report_state']);
    expect(def.data[MAKE_TABLE]?.absence).toBeUndefined();
  });

  it('carries the declared analysis as a record', () => {
    const def = assembleDef(salesDraft({ analysis: analysisOf('groupBy', { by: 'region', measure: 'sales' }) }));
    expect(Object.values(def.analyses ?? {})).toEqual([{ builtin: 'groupBy', by: 'region', measure: 'sales' }]);
  });

  it('THE PIN — it survives JSON, it parses, it builds, and it answers a select', async () => {
    const def = assembleDef(salesDraft({ analysis: analysisOf('groupBy', { by: 'region', measure: 'sales' }) }));
    const roundTripped: unknown = JSON.parse(JSON.stringify(def));
    expect(roundTripped).toEqual(def);

    const parsed = parseDashboardDef(roundTripped);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const session = buildDashboard(parsed.def).createSession();
    const landed = await session.dispatch({ verb: 'select', viewId: 'regions', field: 'region', value: 'North', cause: { ...cause, intent: 'pick the north' } });
    expect(landed.ok).toBe(true);
    expect(session.commits('anywhere')).toHaveLength(1);
  });

  it('the columns the encoding plane holds are the person\'s declarations, name and all', () => {
    expect(fitColumns(salesDraft())[0]).toEqual({ name: 'region', type: 'string', role: 'dimension', label: 'the region' });
  });
});

describe('a reading a host built itself', () => {
  it('is judged exactly like one this wizard read', () => {
    const reading: MakeReading = { rows: 2, columns: [{ name: 'a', type: 'number', sample: [1, 2], distinct: 2, distinctCapped: false }] };
    expect(judgeStep('data', { ...emptyDraft(), csv: 'a\n1\n2\n' }, reading)).toEqual({ ok: true });
    expect(sniffedTypes(reading)).toEqual({ a: 'number' });
  });
});

describe('the offer — step three proposes before it asks', () => {
  it('asks the library only about the kinds this wizard can DRAW, with the channels it draws them from', () => {
    expect(MAKE_PROPOSAL_KINDS).toEqual([
      { chartKind: 'bar', channels: ['category'] },
      { chartKind: 'line', channels: ['x', 'y'] },
    ]);
    // `table` binds nothing, so there is nothing to propose about it
    expect(MAKE_PROPOSAL_KINDS.some((kind) => kind.chartKind === 'table')).toBe(false);
    expect(MAKE_PROPOSALS).toBe(6);
  });

  it('offers charts these columns can carry, best first, each with the plane\'s own reason', () => {
    const { proposals, notEnumerated } = proposalsFor({ ...salesDraft(), views: [] });
    expect(proposals.map((p) => [p.chartKind, p.channels])).toEqual([
      ['bar', { category: 'region' }],
      ['line', { x: 'quarter', y: 'sales' }],
      ['bar', { category: 'report_state' }],
    ]);
    expect(proposals[1]!.reasons).toEqual({
      x: 'the x of a line takes a number or a date; "quarter" is a date and x is an ordered axis — time is the thing an axis reads best',
      y: 'the y of a line takes a number; "sales" is a declared measure, and y carries a magnitude',
    });
    expect(notEnumerated).toEqual([]);
  });

  it('offers nothing rather than something wrong when nothing this wizard draws fits', () => {
    const draft = { ...emptyDraft(), columns: [{ name: 'n', type: 'number' as const, role: 'measure' as const }] };
    expect(proposalsFor(draft).proposals).toEqual([]);
  });

  it('reads the absence vocabulary when there is one — and an ordinary string column when there is not', () => {
    const declared = proposalsFor({ ...salesDraft(), views: [] }).proposals;
    const without = proposalsFor({ ...salesDraft(), views: [], absence: null }).proposals;
    // the absence column is a category either way; what changes is that the
    // declared one may never carry a magnitude, which is the plane's own law
    expect(declared.map((p) => p.chartKind)).toEqual(without.map((p) => p.chartKind));
    expect(without.some((p) => Object.values(p.channels).includes('report_state'))).toBe(true);
  });

  it('a taken chart is an ordinary chart — the same shape the ＋ button makes, judged by the same judge', () => {
    const offered = proposalsFor({ ...salesDraft(), views: [] }).proposals;
    const views = offered.slice(0, 2).map((proposal, i) => viewFromProposal(proposal, i + 1));
    expect(views[0]).toEqual({ id: 'bar1', label: '', chartKind: 'bar', bindings: { category: 'region' } });
    expect(views[1]).toEqual({ id: 'line2', label: '', chartKind: 'line', bindings: { x: 'quarter', y: 'sales' } });

    // one path through the judge: a draft built only of taken offers passes step three
    const draft = { ...salesDraft(), views };
    expect(judgeStep('views', draft, null)).toEqual({ ok: true });
    // and every binding an offer carries is one the picker beside it also accepts
    for (const view of views) for (const channel of MAKE_CHART_KINDS[view.chartKind].channels) expect(misfit(draft, view, channel, view.bindings[channel]!)).toBeNull();
  });
});
