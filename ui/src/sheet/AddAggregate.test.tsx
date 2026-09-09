// @vitest-environment jsdom
/**
 * Cutting a table is an ACT: the form hands the session a name, the group
 * columns and the measures as they were picked, shows what the session said,
 * and judges nothing of its own.
 *
 * The four things it owns are the four things pinned here — what is picked
 * (including the empty group, which is a real answer), that the reducers on
 * offer are the library's and not a list written here, that an act in flight
 * cannot be sent twice, and that the last thing the session said is on screen.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { REDUCER_OPS } from 'vizfootprint/def';
import { AddAggregate, ADD_AGGREGATE_HINT, ADD_AGGREGATE_NO_COLUMNS, ADD_AGGREGATE_PRESENTING, ADD_AGGREGATE_WHOLE_TABLE, type AddAggregateOutcome } from './index.js';
import type { AggregatePick } from '../adapter/types.js';

afterEach(cleanup);

const COLUMNS = ['region', 'year', 'cases'];

const said = (c: HTMLElement): string => (c.querySelector('.vzf-addagg-said') as HTMLElement).textContent ?? '';
const groupSaid = (c: HTMLElement): string => (c.querySelector('[data-vzf="add-aggregate-group-said"]') as HTMLElement).textContent ?? '';
const measures = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.vzf-addagg-measure')];

/** Name the table, pick a group column, fill the first measure, and press the button. */
function cut(c: HTMLElement, name: string, group: string | null, measure: { as: string; op: string; of: string }): void {
  fireEvent.change(c.querySelector('.vzf-addagg-name') as HTMLInputElement, { target: { value: name } });
  if (group !== null) fireEvent.click(c.querySelector(`input[aria-label="group by ${group}"]`) as HTMLInputElement);
  const row = measures(c)[0]!;
  fireEvent.change(row.querySelector('.vzf-addagg-as') as HTMLInputElement, { target: { value: measure.as } });
  fireEvent.change(row.querySelector('.vzf-addagg-op') as HTMLSelectElement, { target: { value: measure.op } });
  fireEvent.change(row.querySelector('.vzf-addagg-of') as HTMLSelectElement, { target: { value: measure.of } });
  fireEvent.click(c.querySelector('button[type="submit"]') as HTMLButtonElement);
}

describe('AddAggregate — the door beside the grid, one level out', () => {
  it('offers the LIBRARY’s reducers, never a list written here', () => {
    const { container } = render(<AddAggregate columns={COLUMNS} onAdd={async () => ({ ok: true })} />);
    const ops = [...(container.querySelector('.vzf-addagg-op') as HTMLSelectElement).options].map((o) => o.value);
    expect(ops).toEqual([...REDUCER_OPS]);
    expect(ops).toContain('countDistinct');
    // the columns it may read are LISTED, never enforced
    expect(container.querySelector('[data-vzf="add-aggregate-columns"]')?.textContent).toBe('the columns it may read: region, year, cases');
    expect([...(container.querySelector('.vzf-addagg-of') as HTMLSelectElement).options].map((o) => o.value)).toEqual(COLUMNS);
  });

  it('hands the name, the groups and the measures over exactly as picked', async () => {
    const asked: [string, AggregatePick][] = [];
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async (name, pick) => {
          asked.push([name, pick]);
          return { ok: true };
        }}
      />,
    );
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect(asked).toEqual([['by_region', { groupBy: ['region'], measures: [{ as: 'total', op: 'sum', of: 'cases' }] }]]));
  });

  it('the empty group is an ANSWER: one row for the whole table, said out loud and sent as []', async () => {
    const asked: AggregatePick[] = [];
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async (_name, pick) => {
          asked.push(pick);
          return { ok: true };
        }}
      />,
    );
    expect(groupSaid(container)).toBe(ADD_AGGREGATE_WHOLE_TABLE);
    cut(container, 'everything', null, { as: 'rows', op: 'count', of: 'region' });
    await waitFor(() => expect(asked).toEqual([{ groupBy: [], measures: [{ as: 'rows', op: 'count', of: 'region' }] }]));
  });

  it('groups are picked and unpicked in the order they were chosen, and the words follow', () => {
    const { container } = render(<AddAggregate columns={COLUMNS} onAdd={async () => ({ ok: true })} />);
    fireEvent.click(container.querySelector('input[aria-label="group by year"]') as HTMLInputElement);
    fireEvent.click(container.querySelector('input[aria-label="group by region"]') as HTMLInputElement);
    expect(groupSaid(container)).toBe('one row per year · region');
    fireEvent.click(container.querySelector('input[aria-label="group by year"]') as HTMLInputElement);
    expect(groupSaid(container)).toBe('one row per region');
  });

  it('measures are added and dropped, and the last one may not be dropped', async () => {
    const asked: AggregatePick[] = [];
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async (_name, pick) => {
          asked.push(pick);
          return { ok: true };
        }}
      />,
    );
    expect(measures(container)).toHaveLength(1);
    expect(container.querySelector('.vzf-addagg-drop')).toBeNull(); // one measure alone has nothing to drop
    fireEvent.click(container.querySelector('.vzf-addagg-more') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.vzf-addagg-more') as HTMLButtonElement);
    expect(measures(container)).toHaveLength(3);
    const second = measures(container)[1]!;
    fireEvent.change(second.querySelector('.vzf-addagg-as') as HTMLInputElement, { target: { value: 'places' } });
    fireEvent.change(second.querySelector('.vzf-addagg-op') as HTMLSelectElement, { target: { value: 'countDistinct' } });
    fireEvent.click(measures(container)[2]!.querySelector('.vzf-addagg-drop') as HTMLButtonElement);
    expect(measures(container)).toHaveLength(2);
    // the row that was edited kept its own values when its neighbour went
    expect((measures(container)[1]!.querySelector('.vzf-addagg-as') as HTMLInputElement).value).toBe('places');
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() =>
      expect(asked).toEqual([
        {
          groupBy: ['region'],
          measures: [
            { as: 'total', op: 'sum', of: 'cases' },
            { as: 'places', op: 'countDistinct', of: 'region' },
          ],
        },
      ]),
    );
  });

  it('clears what was picked and says what landed', async () => {
    const { container } = render(<AddAggregate columns={COLUMNS} onAdd={async () => ({ ok: true })} />);
    fireEvent.click(container.querySelector('.vzf-addagg-more') as HTMLButtonElement);
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect(said(container)).toBe('by_region is a table now — it has a sheet of its own'));
    expect((container.querySelector('.vzf-addagg-name') as HTMLInputElement).value).toBe('');
    expect(groupSaid(container)).toBe(ADD_AGGREGATE_WHOLE_TABLE);
    expect(measures(container)).toHaveLength(1);
    expect((measures(container)[0]!.querySelector('.vzf-addagg-as') as HTMLInputElement).value).toBe('');
  });

  it('shows the SESSION’s own sentence when it refused, and keeps what was picked', async () => {
    const { container } = render(<AddAggregate columns={COLUMNS} onAdd={async () => ({ ok: false, sentence: 'a table is already called "by_region" — that name is the definition’s' })} />);
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect(said(container)).toBe('a table is already called "by_region" — that name is the definition’s'));
    expect((container.querySelector('.vzf-addagg-said') as HTMLElement).classList.contains('vzf-addagg-refused')).toBe(true);
    expect((container.querySelector('.vzf-addagg-name') as HTMLInputElement).value).toBe('by_region');
    expect(groupSaid(container)).toBe('one row per region');
  });

  it('a door that THREW is a sentence too, never a frozen form', async () => {
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async () => {
          throw new Error('the socket closed');
        }}
      />,
    );
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect(said(container)).toBe('the session did not answer: the socket closed'));
  });

  it('says so even when what was thrown was not an Error', async () => {
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- a door this component does not own may throw anything
          throw 'the socket closed';
        }}
      />,
    );
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect(said(container)).toBe('the session did not answer: the socket closed'));
  });

  it('an act in flight cannot be sent twice, and the button says it is working', async () => {
    let land: (outcome: AddAggregateOutcome) => void = () => undefined;
    let asked = 0;
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        onAdd={async () => {
          asked += 1;
          return new Promise<AddAggregateOutcome>((resolve) => {
            land = resolve;
          });
        }}
      />,
    );
    cut(container, 'by_region', 'region', { as: 'total', op: 'sum', of: 'cases' });
    await waitFor(() => expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).textContent).toBe('cutting…'));
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(asked).toBe(1);
    land({ ok: true });
    await waitFor(() => expect(said(container)).toBe('by_region is a table now — it has a sheet of its own'));
  });

  it('Present mode closes the door and says why; a table with no columns says that instead', () => {
    let asked = 0;
    const { container } = render(
      <AddAggregate
        columns={COLUMNS}
        readOnly
        onAdd={async () => {
          asked += 1;
          return { ok: true };
        }}
      />,
    );
    expect(container.querySelector('[data-vzf="add-aggregate-hint"]')?.textContent).toBe(ADD_AGGREGATE_PRESENTING);
    expect((container.querySelector('.vzf-addagg-name') as HTMLInputElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(asked).toBe(0);

    cleanup();
    const open = render(<AddAggregate columns={[]} onAdd={async () => ({ ok: true })} className="wide" />);
    expect(open.container.querySelector('[data-vzf="add-aggregate-hint"]')?.textContent).toBe(ADD_AGGREGATE_HINT);
    expect(open.container.querySelector('[data-vzf="add-aggregate-columns"]')?.textContent).toBe(ADD_AGGREGATE_NO_COLUMNS);
    expect(open.container.querySelector('.vzf-addagg')!.classList.contains('wide')).toBe(true);
  });
});
