/**
 * THE SUITE'S TWO SURFACES — one definition, called two ways.
 *
 * A library of books, the same second definition the desk's tests use, in the
 * shape the CDC demo actually has: a `desk` surface built WITH its writers graph
 * (a second table, a third view, relations, analyses, declared links, words, an
 * FDR procedure) and a `story` surface built WITHOUT it, from the same function.
 *
 * That is the whole point of the fixture. One demo is not one dashboard, and a
 * card that merged these two would advertise a writers view the story page has
 * never heard of. Everything the tests assert about the difference comes out of
 * `libraryDef(graph?)` — nobody writes the difference down twice.
 *
 * The walk is a REAL one: three acts dispatched into a real session, and
 * `logFeatures` read off the commits they landed. A hand-made commit list would
 * be a second library, and the readers would be proved against it rather than
 * against the one that ships.
 */
import { buildDashboard } from 'vizfootprint/def';
import type { DashboardDef } from 'vizfootprint/def';
import { logFeatures } from 'vizfootprint/branches';
import type { LogFeatures } from 'vizfootprint/branches';
import type { DemoSurface, GestureNote } from './types.js';
import { defFeatures } from 'vizfootprint/def';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

export const BOOKS = [
  { id: 'b1', shelf: 'poetry', writer: 'Bishop', year: 1955, pages: 120, listed: 'listed' },
  { id: 'b2', shelf: 'poetry', writer: 'Bishop', year: 1971, pages: 96, listed: 'listed' },
  { id: 'b3', shelf: 'atlases', writer: 'Ogilby', year: 1971, pages: 400, listed: 'not catalogued' },
  { id: 'b4', shelf: 'letters', writer: 'Ogilby', year: 1988, pages: 210, listed: 'listed' },
];

/** The second table the `desk` surface has and the `story` page does not. */
export const WRITERS = [
  { name: 'Bishop', born: 1911, shelf: 'poetry' },
  { name: 'Ogilby', born: 1600, shelf: 'atlases' },
];

/**
 * The definition, with the writers table or without it.
 *
 * Every gate below is the CDC def's own pattern (`src/nndss/def.ts`): a plane
 * that reads the second table is declared only when the second table is there,
 * because a view over a table this def did not declare is what the def door
 * refuses.
 */
export function libraryDef(graph?: { readonly writers: readonly Record<string, unknown>[] }): DashboardDef {
  return {
    meta: { title: 'the library' },
    data: {
      books: {
        source: { format: 'rows', via: 'inline', at: BOOKS },
        key: 'id',
        absence: { field: 'listed', states: ['not catalogued', 'unknown'] },
        columns: { id: { role: 'identifier' }, shelf: { role: 'dimension' }, writer: { role: 'dimension' }, year: { role: 'dimension' }, pages: { role: 'measure' }, listed: { role: 'absence' } },
      },
      // declared as bare `rows`, with no source — so a card reports one format and not two
      ...(graph === undefined ? {} : { writers: { rows: graph.writers, key: 'name', columns: { name: { role: 'identifier' }, born: { role: 'measure' }, shelf: { role: 'dimension' } } } }),
    },
    actors: {
      shelves: { actor: 'user', label: 'Shelves' },
      years: { actor: 'user', label: 'Years' },
      ...(graph === undefined ? {} : { writers: { actor: 'user', label: 'Writers' }, librarian: { actor: 'agent', label: 'The librarian' } }),
    },
    encodings: [
      { viewId: 'shelves', chartKind: 'bar', channels: ['category'], initial: { category: 'shelf' } },
      { viewId: 'years', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'year', y: 'pages' } },
      ...(graph === undefined ? [] : [{ viewId: 'writers', chartKind: 'heatmap', channels: ['x', 'y', 'color'], initial: { x: 'shelf', y: 'name', color: 'born' } }]),
    ],
    ...(graph === undefined
      ? {}
      : {
          relations: [{ from: { table: 'books', column: 'writer' }, to: { table: 'writers', column: 'name' } }],
          analyses: {
            pagesByShelf: { builtin: 'groupBy', by: 'shelf', measure: 'pages' },
            yearVsPages: { builtin: 'correlation', x: 'year', y: 'pages' },
          },
          grains: [{ viewId: 'shelves', keys: ['shelf'] }, { viewId: 'writers', keys: ['name'] }],
          capabilities: [{ viewId: 'writers', canProbe: true, encodings: ['point', 'match'] as const }],
          linkDefault: 'crossfilter' as const,
          links: [
            { source: 'shelves', kind: 'point', target: 'writers', response: 'highlight', fold: 'the writers on the lit shelves', label: 'a shelf lights its writers' },
            { source: 'years', kind: 'interval', target: 'shelves', response: 'none', onClear: 'leave', label: 'a year brush never narrows the shelves' },
          ],
          encodingRules: { rules: [{ rule: 'never-on' as const, column: 'id', channels: ['color'], sentence: 'a book id is not a colour' }], ruleScope: 'view' as const, onInvalid: 'refuse' },
          prose: [{ viewId: 'shelves', slots: { caption: { text: 'what is on the shelves', author: { kind: 'human', by: 'the librarian' } } } }],
          fdr: { procedure: 'LORD++' as const, alpha: 0.05 },
        }),
    defaultTable: 'books',
  };
}

/** How a person produces each verb on this fixture's desk — the hand-written half, `annotate` included as the honest gap. */
export const LIBRARY_GESTURES: readonly GestureNote[] = [
  { verb: 'select', gesture: 'click a bar' },
  { verb: 'filter', gesture: 'drag across the year axis' },
  { verb: 'reencode', gesture: 'click an axis label and pick a column' },
  { verb: 'annotate', gesture: null },
];

/**
 * The two surfaces, ready for a card — the desk with a real walk on it, the
 * story page with none.
 *
 * The story surface deliberately carries NO `walked`: "nobody has walked this
 * one" and "somebody walked it and did nothing" are different cards, and the
 * suite holds the card to drawing the first as a sentence.
 */
export async function librarySurfaces(): Promise<{ readonly desk: DemoSurface; readonly story: DemoSurface }> {
  const deskBuild = buildDashboard(libraryDef({ writers: WRITERS }));
  const session = deskBuild.createSession();
  await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
  await session.dispatch({ verb: 'filter', viewId: 'years', field: 'year', range: [1950, 1975], cause });
  await session.dispatch({ verb: 'reencode', viewId: 'years', channel: 'y', field: 'year', cause });
  const walked = logFeatures(session.commits('anywhere'), { bookmarks: [], saved: [] });
  return {
    desk: {
      demo: 'the library',
      surface: 'desk',
      blurb: 'the whole cockpit, built with the writers table',
      href: '#desk',
      declares: defFeatures(deskBuild),
      walked,
      byHand: LIBRARY_GESTURES,
    },
    story: {
      demo: 'the library',
      surface: 'story page',
      declares: defFeatures(buildDashboard(libraryDef())),
    },
  };
}

/**
 * THE OTHER WALKS the suite needs, all of them real.
 *
 * Three arms of the reader that one straight user walk cannot reach, and each is
 * dispatched rather than typed: a SECOND LANE (act while looking at the past), a
 * correlation id on an ordinary USER act, and the same id on an AGENT's. The
 * last two are the pair a card must never merge — an id is a caller's join key,
 * and only the cause names who acted.
 */
export async function otherWalks(): Promise<{ readonly branched: LogFeatures; readonly correlatedOnly: LogFeatures; readonly agent: LogFeatures }> {
  return { branched: await walkBranched(), correlatedOnly: await walkCorrelated(cause), agent: await walkCorrelated(agentCause) };
}

const agentCause = { requestedBy: 'agent', computedBy: 'agent' } as const;

/** Two acts, then a seek back to the first and a third act — the second lane, landed rather than declared. */
async function walkBranched(): Promise<LogFeatures> {
  const session = buildDashboard(libraryDef()).createSession();
  await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause });
  await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'letters', cause });
  const first = session.commits('anywhere')[0]!;
  session.seek(first.id);
  await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'atlases', cause });
  return logFeatures(session.commits('anywhere'), { bookmarks: ['a moment'], saved: [] });
}

/** One act carrying a caller's join key — under whichever cause is handed in. */
async function walkCorrelated(under: typeof cause | typeof agentCause): Promise<LogFeatures> {
  const session = buildDashboard(libraryDef()).createSession();
  await session.dispatch({ verb: 'select', viewId: 'shelves', field: 'shelf', value: 'poetry', cause: under, correlationId: 'batch-1' });
  return logFeatures(session.commits('anywhere'));
}
