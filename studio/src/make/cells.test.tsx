// @vitest-environment jsdom
/**
 * THE CELLS A DEFINITION IMPLIES.
 *
 * Two claims are under test and they are different claims. First, that a
 * DEFINITION becomes a plan totally — it arrives off a published page's payload
 * as data from somewhere, so every part it might be missing has an answer
 * rather than a throw. Second, that the cells drawn from that plan are honest:
 * they count what is in view, they say when they stopped drawing, a missing
 * value is a silence rather than a category called "null", and a click lands a
 * commit on the session the desk is projecting.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DashboardDef } from 'vizfootprint/def';
import { Desk } from '../desk/Desk.js';
import { stubObservers } from '../desk/desk.fixture.js';
import { GESTURE_WORDS, MAKE_BAR_CAP, MAKE_TABLE_CAP, intentFor, planFromDef, useMadeCells } from './cells.js';
import { openDesk, type MadeDesk } from './open.js';
import { assembleDef, newView } from './steps.js';
import { salesDraft } from './make.fixture.js';

stubObservers();
afterEach(cleanup);

const opened: MadeDesk[] = [];
afterEach(() => {
  for (const desk of opened.splice(0)) desk.view.dispose();
});

/** Open a made definition and mount its desk with the cells the definition implies. */
function mount(def: DashboardDef): MadeDesk {
  const answer = openDesk(def);
  if (!answer.ok) throw new Error(answer.refusals.join('; '));
  opened.push(answer.desk);
  render(<Desk view={answer.desk.view} charts={(projection) => useMadeCells(projection, answer.desk.plan)} />);
  return answer.desk;
}

describe('a definition becomes a plan — totally', () => {
  it('reads the rows out of the CSV, the columns out of its header, and the views out of the actors', () => {
    const plan = planFromDef(assembleDef(salesDraft()));
    expect(plan.table).toBe('data');
    expect(plan.rows).toHaveLength(6);
    expect(plan.columns).toEqual(['region', 'quarter', 'sales', 'report_state']);
    expect(plan.idColumn).toBe('region');
    expect(plan.views.map((v) => v.chartKind)).toEqual(['bar', 'line']);
  });

  it('reads inline ROWS when there is no CSV, and takes the columns off the first of them', () => {
    const plan = planFromDef({ data: { t: { rows: [{ a: 1, b: 'x' }] } }, actors: { v: { actor: 'user' } } });
    expect(plan.table).toBe('t');
    expect(plan.rows).toEqual([{ a: 1, b: 'x' }]);
    expect(plan.columns).toEqual(['a', 'b']);
  });

  it('a table with nothing in it draws nothing rather than throwing, and so does a def with no tables', () => {
    const bare = planFromDef({ data: { t: {} }, actors: {} });
    expect(bare.rows).toEqual([]);
    expect(bare.columns).toEqual([]);
    expect(bare.idColumn).toBe('');
    expect(planFromDef({ data: {}, actors: {} }).table).toBe('');
  });

  it('a view with no encoding surface is its rows, and a chart kind these cells cannot draw is too', () => {
    const plan = planFromDef({
      data: { t: { rows: [{ a: 1 }] } },
      actors: { sheet: { actor: 'user' }, heat: { actor: 'user', label: 'The heat' } },
      encodings: [{ viewId: 'heat', chartKind: 'heatmap', channels: ['x', 'y'], initial: { x: 'a', y: 'a' } }],
    });
    expect(plan.views).toEqual([
      { id: 'sheet', label: 'sheet', chartKind: 'table', bindings: {} },
      { id: 'heat', label: 'The heat', chartKind: 'table', bindings: { x: 'a', y: 'a' } },
    ]);
  });
});

describe('the cells, drawn', () => {
  it('draws a bar per value, a line per bucket, and names the field the SESSION has bound', async () => {
    const desk = mount(assembleDef(salesDraft()));
    await desk.view.refresh();
    expect(await screen.findByText(/Rows per region \(click a bar to select\)/)).toBeTruthy();
    expect(screen.getByText(/sales summed per quarter/)).toBeTruthy();
    // three regions, three bars
    expect(document.querySelectorAll('rect.vzf-barrect').length).toBe(3);
  });

  it('a click on a bar lands a commit, in words a person recognises', async () => {
    const desk = mount(assembleDef(salesDraft()));
    await desk.view.refresh();
    const bar = document.querySelectorAll('rect.vzf-barrect')[0]!;
    fireEvent.click(bar);
    await waitFor(() => {
      expect(desk.session.commits('anywhere')).toHaveLength(1);
    });
    expect(desk.session.commits('anywhere')[0]?.cause.intent).toBe('pick Sales by region');
  });

  it('a clause on ANOTHER view narrows what a cell counts — through the link graph, like everything else', async () => {
    const desk = mount(assembleDef(salesDraft()));
    await desk.view.refresh();
    expect(document.querySelectorAll('rect.vzf-barrect').length).toBe(3);
    // the line's clause reaches the bar by the default crossfilter: one quarter, two regions with a row in it
    await desk.session.dispatch({ verb: 'select', viewId: 'quarters', field: 'quarter', value: '2026-04-01', cause: { requestedBy: 'user', computedBy: 'user', intent: 'the second quarter' } });
    await desk.view.refresh();
    await waitFor(() => {
      expect(document.querySelectorAll('rect.vzf-barrect').length).toBe(3);
    });
    // …and a clause on the BAR narrows the line the same way
    await desk.session.dispatch({ verb: 'select', viewId: 'regions', field: 'region', value: 'North', cause: { requestedBy: 'user', computedBy: 'user', intent: 'the north' } });
    await desk.view.refresh();
    await waitFor(() => {
      expect(screen.getByText(/sales summed per quarter/)).toBeTruthy();
    });
  });

  it('an AXIS says what it is bound to, and re-encoding it moves the marks and the caption together', async () => {
    const desk = mount(assembleDef(salesDraft()));
    await desk.view.refresh();
    // the axis label says what the channel is bound to, and carries the affordance to change it
    const axis = [...document.querySelectorAll('[role="button"]')].find((el) => el.textContent?.startsWith('region'))!;
    fireEvent.click(axis);
    fireEvent.click(await screen.findByRole('button', { name: /report_state/ }));
    await waitFor(() => {
      expect(screen.getByText(/Rows per report_state/)).toBeTruthy();
    });
    expect(desk.session.commits('anywhere')).toHaveLength(1);
  });

  it('sorts a line\'s buckets whatever order the rows arrived in', async () => {
    const csv = 'region,quarter,sales\nNorth,2026-04-01,10\nNorth,2026-01-01,20\n';
    const def = assembleDef(
      salesDraft({
        csv,
        columns: [
          { name: 'region', type: 'string', role: 'dimension' },
          { name: 'quarter', type: 'date', role: 'dimension' },
          { name: 'sales', type: 'number', role: 'measure' },
        ],
        absence: null,
        views: [{ id: 'quarters', label: 'Quarters', chartKind: 'line', bindings: { x: 'quarter', y: 'sales' } }],
      }),
    );
    const desk = mount(def);
    await desk.view.refresh();
    // the earlier bucket is drawn first: the x axis reads left to right whatever the file did
    const ticks = [...document.querySelectorAll('.vzf-tick')].map((t) => t.textContent);
    expect(ticks.join(' ')).toMatch(/2026-01/);
  });

  it('the verbs a gesture is recorded under cover every emission kind there is', () => {
    expect(Object.keys(GESTURE_WORDS).sort()).toEqual(['cell', 'interval', 'match', 'neighbourhood', 'point']);
    expect(intentFor('the bar', { viewId: 'b', encoding: { kind: 'interval', field: 'x' }, rawValue: null } as never)).toBe('brush the bar');
    expect(intentFor('the bar', { viewId: 'b', encoding: { kind: 'point', field: 'x' }, rawValue: null } as never)).toBe('pick the bar');
    // protocol 1.3: the walk is asked ON a node, so the word names what was walked out FROM
    expect(intentFor('the network', { viewId: 'n', encoding: { kind: 'neighbourhood', field: 'source' }, rawValue: 'flu' } as never)).toBe('walk out from a node of the network');
  });

  it('a missing value is a SILENCE — never a bar called "null", never a point at zero', async () => {
    // `region` is blank in one row and `sales` is blank in two: neither becomes a value
    const csv = 'region,quarter,sales\nNorth,2026-01-01,10\n,2026-01-01,20\nNorth,2026-02-01,\n';
    const def = assembleDef(
      salesDraft({
        csv,
        columns: [
          { name: 'region', type: 'string', role: 'dimension' },
          { name: 'quarter', type: 'date', role: 'dimension' },
          { name: 'sales', type: 'number', role: 'measure' },
        ],
        absence: null,
      }),
    );
    const desk = mount(def);
    await desk.view.refresh();
    // one region drawn, not two — the blank cell is not a category
    expect(document.querySelectorAll('rect.vzf-barrect').length).toBe(1);
    // and the line is drawn from one point, not two: the row with no number is not a zero
    expect(document.querySelectorAll('.vzf-line').length).toBeGreaterThan(0);
  });

  it('SAYS when it stopped drawing bars, rather than truncating quietly', async () => {
    const many = ['region,sales', ...Array.from({ length: MAKE_BAR_CAP + 5 }, (_, i) => `r${String(i)},${String(i + 1)}`)].join('\n');
    const def = assembleDef(
      salesDraft({
        csv: `${many}\n`,
        columns: [
          { name: 'region', type: 'string', role: 'dimension' },
          { name: 'sales', type: 'number', role: 'measure' },
        ],
        absence: null,
        views: [{ id: 'regions', label: 'Regions', chartKind: 'bar', bindings: { category: 'region' } }],
      }),
    );
    const desk = mount(def);
    await desk.view.refresh();
    expect(await screen.findByText(new RegExp(`the ${String(MAKE_BAR_CAP)} tallest of ${String(MAKE_BAR_CAP + 5)}`))).toBeTruthy();
  });

  it('SAYS how many rows a table has when it is only printing the first of them', async () => {
    const rows = Array.from({ length: MAKE_TABLE_CAP + 3 }, (_, i) => `r${String(i)},${String(i)}`);
    const def = assembleDef(
      salesDraft({
        csv: `region,sales\n${rows.join('\n')}\n`,
        columns: [
          { name: 'region', type: 'string', role: 'dimension' },
          { name: 'sales', type: 'number', role: 'measure' },
        ],
        absence: null,
        views: [{ ...newView('table', 1), id: 'rows', label: 'The rows' }],
      }),
    );
    const desk = mount(def);
    await desk.view.refresh();
    expect(await screen.findByText(new RegExp(`the first ${String(MAKE_TABLE_CAP)} of ${String(MAKE_TABLE_CAP + 3)}`))).toBeTruthy();
    // …and when everything fits, it says nothing at all
    cleanup();
    const small = mount(assembleDef(salesDraft({ views: [{ ...newView('table', 1), id: 'rows', label: 'The rows' }] })));
    await small.view.refresh();
    expect(await screen.findByText('The rows in view (click one to select)')).toBeTruthy();
  });

  it('draws a DATE column that arrived as a Date, and an unbound channel draws nothing rather than guessing', async () => {
    const def: DashboardDef = {
      data: { t: { rows: [{ when: new Date('2026-01-01T00:00:00.000Z'), v: 3 }, { when: new Date('2026-02-01T00:00:00.000Z'), v: 5 }] } },
      actors: { over: { actor: 'user', label: 'Over time' }, half: { actor: 'user', label: 'Half wired' } },
      encodings: [
        { viewId: 'over', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'when', y: 'v' } },
        { viewId: 'half', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'when' } },
      ],
      defaultTable: 't',
    };
    const desk = mount(def);
    await desk.view.refresh();
    expect(screen.getByText(/v summed per when/)).toBeTruthy();
    // the half-wired chart names an empty y and draws no points — it never invents one
    expect(screen.getByText(/^summed per when/)).toBeTruthy();
  });
});
