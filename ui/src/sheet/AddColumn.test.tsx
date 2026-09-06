// @vitest-environment jsdom
/**
 * Adding a column is an ACT: the form hands the session a name and an
 * expression, shows what the session said, and judges nothing of its own.
 *
 * The three things it owns are the three things pinned here — what is typed,
 * that an act in flight cannot be sent twice, and that the last thing the
 * session said is on screen (a refusal in its own words, a landing in the
 * column's).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AddColumn, ADD_COLUMN_HINT, ADD_COLUMN_NO_NUMBERS, ADD_COLUMN_PRESENTING, type AddColumnOutcome } from './index.js';

afterEach(cleanup);

/** Fill the two fields and press the button. */
function fill(container: HTMLElement, name: string, expression: string): void {
  fireEvent.change(container.querySelector('.vzf-addcol-name') as HTMLInputElement, { target: { value: name } });
  fireEvent.change(container.querySelector('.vzf-addcol-formula') as HTMLInputElement, { target: { value: expression } });
  fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
}

const said = (container: HTMLElement): string => (container.querySelector('.vzf-addcol-said') as HTMLElement).textContent ?? '';

describe('AddColumn — the door beside the grid', () => {
  it('lists the columns a formula may read, and says so when there are none', () => {
    const { container } = render(<AddColumn columns={['cases', 'ytd']} onAdd={async () => ({ ok: true })} />);
    expect(container.querySelector('[data-vzf="add-column-columns"]')?.textContent).toBe('the numbers it may read: cases, ytd');
    expect(container.querySelector('.vzf-addcol-hint')?.textContent).toBe(ADD_COLUMN_HINT);

    cleanup();
    const empty = render(<AddColumn columns={[]} onAdd={async () => ({ ok: true })} />);
    expect(empty.container.querySelector('[data-vzf="add-column-columns"]')?.textContent).toBe(ADD_COLUMN_NO_NUMBERS);
  });

  it('hands the name and the expression over exactly as typed', async () => {
    const asked: [string, string][] = [];
    const { container } = render(
      <AddColumn
        columns={['cases']}
        onAdd={async (name, expression) => {
          asked.push([name, expression]);
          return { ok: true };
        }}
      />,
    );
    fill(container, 'rate', 'cases / 1000');
    await waitFor(() => expect(asked).toEqual([['rate', 'cases / 1000']]));
  });

  it('clears the fields and says what landed', async () => {
    const { container } = render(<AddColumn columns={['cases']} onAdd={async () => ({ ok: true })} />);
    fill(container, 'rate', 'cases / 1000');
    await waitFor(() => expect(said(container)).toBe('rate is on the sheet'));
    expect((container.querySelector('.vzf-addcol-name') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('.vzf-addcol-formula') as HTMLInputElement).value).toBe('');
  });

  it('shows the SESSION’s own sentence when it refused, and keeps what was typed', async () => {
    const sentence = 'the formula "cases / disease" reads "disease", which table "cells" holds as string — a formula reads numbers';
    const { container } = render(<AddColumn columns={['cases']} onAdd={async (): Promise<AddColumnOutcome> => ({ ok: false, sentence })} />);
    fill(container, 'rate', 'cases / disease');
    await waitFor(() => expect(said(container)).toBe(sentence));
    expect(container.querySelector('.vzf-addcol-refused')).not.toBeNull();
    // nothing was lost: a refusal is a thing to fix, not a thing to retype
    expect((container.querySelector('.vzf-addcol-formula') as HTMLInputElement).value).toBe('cases / disease');
  });

  it('says so when the door itself threw, rather than freezing on it', async () => {
    const { container } = render(
      <AddColumn
        columns={['cases']}
        onAdd={() => {
          throw new Error('the server is not there');
        }}
      />,
    );
    fill(container, 'rate', 'cases / 1000');
    await waitFor(() => expect(said(container)).toBe('the session did not answer: the server is not there'));
    // …and the button is usable again
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so even when what was thrown was not an Error', async () => {
    const { container } = render(
      <AddColumn
        columns={['cases']}
        onAdd={() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- a door this component does not own may throw anything
          throw 'the socket closed';
        }}
      />,
    );
    fill(container, 'rate', 'cases / 1000');
    await waitFor(() => expect(said(container)).toBe('the session did not answer: the socket closed'));
  });

  it('cannot send the same act twice while it is in flight', async () => {
    let landed: (() => void) | undefined;
    let calls = 0;
    const { container } = render(
      <AddColumn
        columns={['cases']}
        onAdd={async () => {
          calls += 1;
          await new Promise<void>((resolve) => {
            landed = resolve;
          });
          return { ok: true };
        }}
      />,
    );
    fill(container, 'rate', 'cases / 1000');
    await waitFor(() => expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).textContent).toBe('adding…'));
    // a second press while the first is in flight is not a second act
    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(calls).toBe(1);
    landed?.();
    await waitFor(() => expect(said(container)).toBe('rate is on the sheet'));
  });

  it('is closed in Present mode, and says why', () => {
    let calls = 0;
    const { container } = render(
      <AddColumn
        columns={['cases']}
        readOnly
        onAdd={async () => {
          calls += 1;
          return { ok: true };
        }}
      />,
    );
    expect(container.querySelector('.vzf-addcol-hint')?.textContent).toBe(ADD_COLUMN_PRESENTING);
    expect((container.querySelector('.vzf-addcol-name') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    // …and even a submit that got past the button does nothing
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(calls).toBe(0);
  });

  it('takes a host class beside its own', () => {
    const { container } = render(<AddColumn columns={[]} className="mine" onAdd={async () => ({ ok: true })} />);
    expect(container.querySelector('form')?.className).toBe('vzf vzf-addcol mine');
  });
});
