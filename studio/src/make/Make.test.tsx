// @vitest-environment jsdom
/**
 * THE WHOLE WALK — a person with a spreadsheet, four steps, a desk, a file.
 *
 * Driven the way a person drives it: paste, read, declare, bind, open, click,
 * publish. Nothing is stubbed except the two things a browser does that jsdom
 * does not (layout, and handing over a download), because the claim being made
 * is that the four steps compose — and a test that called the step functions in
 * order would be testing the functions again rather than the composition.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { encodeStoryPayload, storyPayloadScript, STORY_PAYLOAD_ID } from 'vizfootprint-ui/story/payload';
import { stubObservers } from '../desk/desk.fixture.js';
import { Make } from './Make.js';
import { madePayload } from './publish.js';
import { openDesk } from './open.js';
import { assembleDef, MAKE_CEILING_SENTENCE } from './steps.js';
import { SALES_CSV, salesDraft } from './make.fixture.js';

stubObservers();

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

const refusals = (): readonly string[] => [...document.querySelectorAll('[data-vzf="make-refusals"] li')].map((li) => li.textContent ?? '');
const next = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /Next →|Open the desk →/ }));
};
const pick = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/** Steps one and two, driven as a person drives them. */
function throughTheDeclarations(): void {
  render(<Make />);
  fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
  fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
  next();
  pick('the role of region', 'dimension');
  pick('the role of quarter', 'dimension');
  pick('quarter is a', 'date');
  pick('the role of sales', 'measure');
  pick('the absence column', 'report_state');
  next();
}

/** …and step three, with a bar and a line on it. */
function throughTheCharts(): void {
  throughTheDeclarations();
  fireEvent.change(screen.getByLabelText("the dashboard's title"), { target: { value: 'Sales' } });
  fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
  pick('category of bar1', 'region');
  fireEvent.click(screen.getByRole('button', { name: /a line —/ }));
  pick('x of line2', 'quarter');
  pick('y of line2', 'sales');
  next();
}

describe('step 1 — bring data', () => {
  it('states the ceiling before anything else, and will not go on with nothing pasted', () => {
    render(<Make />);
    expect(screen.getByText(MAKE_CEILING_SENTENCE)).toBeTruthy();
    next();
    expect(refusals()).toEqual(['there is nothing to read yet — paste a CSV, or choose a file']);
  });

  it('shows what arrived — the columns, what they read as, and where the file sits against the ceiling', () => {
    render(<Make />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    const described = document.querySelector('[data-vzf="make-description"]');
    expect(described?.textContent).toContain('region');
    expect(described?.textContent).toContain('60 … 150');
    expect(document.querySelector('[data-vzf="make-ceiling-verdict"]')?.textContent).toContain('6 rows — inside the ninety thousand');
  });

  it('refuses a CSV with no rows, in a sentence, and shows no description at all', () => {
    render(<Make />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: 'a,b\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    expect(refusals()[0]).toContain('a header and no rows');
    expect(document.querySelector('[data-vzf="make-description"]')).toBeNull();
  });

  it('reads a chosen FILE the same way it reads pasted text, and does nothing when none was chosen', async () => {
    render(<Make />);
    const input = screen.getByLabelText(/choose a file/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect((screen.getByLabelText('the CSV') as HTMLTextAreaElement).value).toBe('');

    fireEvent.change(input, { target: { files: [new File([SALES_CSV], 'sales.csv', { type: 'text/csv' })] } });
    await waitFor(() => {
      expect((screen.getByLabelText('the CSV') as HTMLTextAreaElement).value).toBe(SALES_CSV);
    });
  });
});

describe('step 2 — check and describe', () => {
  it('refuses to go on while a column has no declared role, naming each one', () => {
    render(<Make />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    next();
    next();
    expect(refusals()).toHaveLength(4);
    expect(refusals()[0]).toContain('"region" has no declared role');
  });

  it('stops asking for a role once a column is the ABSENCE column, and says why', () => {
    render(<Make />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    next();
    pick('the absence column', 'report_state');
    expect(screen.getByText(/its role is absence, derived from the vocabulary above/)).toBeTruthy();
    expect(screen.queryByLabelText('the role of report_state')).toBeNull();
    next();
    expect(refusals()).toHaveLength(3); // region, quarter and sales — never report_state
  });

  it('passes the LIBRARY\'s refusal on a vocabulary that cannot say "unknown"', () => {
    render(<Make />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    next();
    pick('the role of region', 'dimension');
    pick('the role of quarter', 'dimension');
    pick('the role of sales', 'measure');
    pick('the absence column', 'report_state');
    fireEvent.change(screen.getByLabelText('the absence vocabulary'), { target: { value: 'present, unavailable' } });
    next();
    expect(refusals().join('\n')).toContain('must include "unknown"');
  });

  it('takes a label and a scale, and going Back leaves the declarations where they were', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    pick('the scale of sales', 'continuous');
    fireEvent.change(screen.getByLabelText('what to call region'), { target: { value: 'the region' } });
    fireEvent.change(screen.getByLabelText('what to call region'), { target: { value: '' } });
    expect((screen.getByLabelText('the role of region') as HTMLSelectElement).value).toBe('dimension');
    pick('the role of region', '');
    next();
    expect(refusals()[0]).toContain('"region" has no declared role');
  });
});

describe('step 3 — visualize', () => {
  it('refuses a dashboard with no charts, then one whose channel carries nothing', () => {
    throughTheDeclarations();
    next();
    expect(refusals()[0]).toContain('no charts yet');
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    next();
    expect(refusals()[0]).toContain('has nothing on its category channel');
  });

  it('greys what cannot sit on a channel and prints the plane\'s own sentence for it', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByRole('button', { name: /a line —/ }));
    const xChannel = screen.getByLabelText('x of line1') as HTMLSelectElement;
    const refusedOption = within(xChannel).getByRole('option', { name: /region — refused/ }) as HTMLOptionElement;
    expect(refusedOption.disabled).toBe(true);
    expect(document.querySelector('[data-vzf="make-view"] ul')?.textContent).toContain('"region"');
  });

  it('takes the dashboard\'s summary as declared prose, and a numeric analysis option as a number', () => {
    throughTheDeclarations();
    type("the dashboard's summary", 'What each region sold.');
    pick('Run an analysis', 'clustering');
    pick('binning', 'sales');
    type('into this many bins', '3');
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    next();
    // it opened: the record was well formed, so the desk is there
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
  });

  it('offers the formula, with its own words and the columns it may read, and carries it into the def', () => {
    throughTheDeclarations();
    type("the dashboard's summary", 'What each region sold.');
    pick('Run an analysis', 'formula');
    // the picker's other four ask a person to CHOOSE a column; this one asks them to write
    expect(document.querySelector('[data-vzf="make-formula-columns"]')?.textContent).toContain('The columns it may read: region, quarter, sales, report_state.');
    type('working out', 'sales / 10');
    type('into a column called', 'tenths');
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    next();
    // it opened: the record was well formed, so the library built it
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
  });

  it('refuses a formula the grammar has no rule for, in the library\'s own sentence', () => {
    throughTheDeclarations();
    pick('Run an analysis', 'formula');
    type('working out', 'sales %');
    type('into a column called', 'odd');
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    next();
    expect(refusals().join('\n')).toContain('the formula has no rule for "%" at position 7');
  });

  it('says plainly that anything beyond the five builtins is a developer\'s, and carries the one it is given', () => {
    throughTheCharts();
    // the desk opened, so go back and add the analysis
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Change the charts/ }));
    expect(screen.getByText(/an analysis with code in it is written in TypeScript/)).toBeTruthy();
    pick('Run an analysis', 'groupBy');
    pick('grouped by', 'region');
    next();
    expect(refusals().join('\n')).toContain('measure');
    pick('averaging', 'sales');
    next();
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
  });

  it('removes a chart, and changing a kind drops the bindings that were for the other one', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    pick('how chart 1 is drawn', 'line');
    expect(screen.getByLabelText('x of bar1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('the name of chart 1'), { target: { value: 'over time' } });
    fireEvent.change(screen.getByLabelText('the title of chart 1'), { target: { value: 'Over time' } });
    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    next();
    expect(refusals()[0]).toContain('no charts yet');
  });
});

describe('step 3 — the offer, before the ask', () => {
  it('offers charts these columns can carry, with the plane\'s own reasons, and chooses none of them', () => {
    throughTheDeclarations();
    const cards = [...document.querySelectorAll('[data-vzf="make-proposal"]')];
    expect(cards.map((card) => card.querySelector('strong')?.textContent)).toEqual(['a bar', 'a line', 'a bar']);
    expect(cards[1]!.textContent).toContain('is a date and x is an ordered axis');
    expect(cards[1]!.textContent).toContain('"sales" is a declared measure');
    // the picker is still there, underneath, for anybody who wants something else
    expect(screen.getByRole('button', { name: /a table —/ })).toBeTruthy();
    // and nothing was taken for the person: the step refuses to move on
    next();
    expect(refusals()[0]).toContain('no charts yet');
  });

  it('takes one with a click, into the same draft the picker fills, and opens the desk on it', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByLabelText('take the line of x = quarter · y = sales'));
    // it is an ORDINARY chart now — named, bound, editable, removable
    expect((screen.getByLabelText('x of line1') as HTMLSelectElement).value).toBe('quarter');
    expect((screen.getByLabelText('y of line1') as HTMLSelectElement).value).toBe('sales');
    fireEvent.change(screen.getByLabelText('the title of chart 1'), { target: { value: 'Sales by quarter' } });
    next();
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
  });

  it('a taken chart and a hand-bound one land in one draft, through one judge', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByLabelText('take the bar of category = region'));
    fireEvent.click(screen.getByRole('button', { name: /a line —/ }));
    pick('x of line2', 'quarter');
    pick('y of line2', 'sales');
    next();
    expect(screen.getByRole('button', { name: 'Dashboard menu' })).toBeTruthy();
  });
});

describe('step 4 — the desk, and the file', () => {
  it('opens a whole desk with no shell code of its own, and a click lands the first commit', async () => {
    throughTheCharts();
    expect(screen.getByRole('button', { name: /Commit log/ })).toBeTruthy();
    expect(await screen.findByText(/Rows per region/)).toBeTruthy();

    fireEvent.click(document.querySelectorAll('rect.vzf-barrect')[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit log 1/ })).toBeTruthy();
    });
  });

  it('REFUSES to publish a page whose code lives somewhere else, naming the files', async () => {
    document.head.insertAdjacentHTML('beforeend', '<script src="/assets/index-abc.js"></script>');
    throughTheCharts();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Publish as one file/ }));
    expect(await screen.findByText(/loads its code from 1 other file/)).toBeTruthy();
  });

  it('publishes ONE file carrying the acts and the definition, and says what it handed over', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob): string => {
        blobs.push(b);
        return 'blob:made';
      },
      revokeObjectURL: (): void => undefined,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    throughTheCharts();
    fireEvent.click(document.querySelectorAll('rect.vzf-barrect')[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit log 1/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Publish as one file/ }));

    expect(await screen.findByText(/published dashboard\.html/)).toBeTruthy();
    expect(screen.getByText(/carrying 1 acts and this desk's whole definition/)).toBeTruthy();
    const html = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.readAsText(blobs[0]!);
    });
    expect(html).toContain(`<script id="${STORY_PAYLOAD_ID}"`);
    expect(html).toContain('<!doctype html>');

    click.mockRestore();
  });

  it('REFUSES to publish past a ceiling the host set, naming the number that applies', async () => {
    render(<Make ceiling={1} />);
    fireEvent.change(screen.getByLabelText('the CSV'), { target: { value: SALES_CSV } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this table' }));
    next();
    pick('the role of region', 'dimension');
    pick('the role of quarter', 'dimension');
    pick('the role of sales', 'measure');
    pick('the role of report_state', 'dimension');
    next();
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Publish as one file/ }));
    expect(await screen.findByText(/past the 1 B a single file inlines/)).toBeTruthy();
  });

  it('going back to step three discards the acts on the desk it rebuilds — and says so', async () => {
    throughTheCharts();
    fireEvent.click(document.querySelectorAll('rect.vzf-barrect')[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit log 1/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard menu' }));
    const item = screen.getByRole('menuitem', { name: /Change the charts/ });
    // the item says out loud what it costs — a rebuild is not an edit
    expect(item.textContent).toContain('the acts on this one are discarded');
    fireEvent.click(item);

    expect(screen.getByLabelText("the dashboard's title")).toBeTruthy();
    next();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit log 0/ })).toBeTruthy();
    });
  });

  it('a definition the BUILD door refuses never opens a desk — the sentence is printed at step three', () => {
    throughTheDeclarations();
    fireEvent.click(screen.getByRole('button', { name: /a bar —/ }));
    pick('category of bar1', 'region');
    fireEvent.change(screen.getByLabelText('the name of chart 1'), { target: { value: 'dashboard' } });
    next();
    expect(refusals().join('\n')).toContain('"dashboard" is the prose plane\'s name for the cockpit itself');
    expect(screen.queryByRole('button', { name: 'Dashboard menu' })).toBeNull();
  });
});

describe('the same bundle, opened as the file it published', () => {
  it('is the DESK, not the wizard — and it replays the acts the file was published with', async () => {
    const opened = openDesk(assembleDef(salesDraft()));
    if (!opened.ok) throw new Error('the fixture must open');
    await opened.desk.session.dispatch({ verb: 'select', viewId: 'regions', field: 'region', value: 'North', cause: { requestedBy: 'user', computedBy: 'user', intent: 'pick the north' } });
    const encoded = await encodeStoryPayload(madePayload({ def: opened.desk.def, session: opened.desk.session, rows: 6, builtAt: '2026-09-05' }));
    if (!encoded.ok) throw new Error(encoded.sentence);
    opened.desk.view.dispose();
    document.body.innerHTML = storyPayloadScript(encoded.text);

    const { container } = render(<Make mountId="root" />);
    await waitFor(() => {
      expect(container.querySelector('[data-vzf="dashboard-page-reading"]')).toBeNull();
    });
    expect(container.querySelector('[data-vzf="make"]')).toBeNull(); // no wizard anywhere
    expect(container.querySelector('[data-vzf="dashboard-front-data"]')?.textContent).toContain('1 acts replayed, 0 bookmarks named');
    expect(await screen.findByText(/Rows per region/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Commit log 1/ })).toBeTruthy();
  });

  it('a file published without a definition says so, and shows no desk', async () => {
    const encoded = await encodeStoryPayload({ log: [], bookmarks: [], meta: { builtAt: '2026-09-05', data: { via: 'inline' } } });
    if (!encoded.ok) throw new Error(encoded.sentence);
    document.body.innerHTML = storyPayloadScript(encoded.text);
    const { container } = render(<Make />);
    await waitFor(() => {
      expect(container.querySelector('[data-vzf="dashboard-page-refused"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-vzf="dashboard-page-refused"]')?.textContent).toContain('carries no definition');
  });

  it('a file carrying a definition the library refuses says the library\'s own sentence', async () => {
    const encoded = await encodeStoryPayload({ log: [], bookmarks: [], meta: { builtAt: '2026-09-05', data: { via: 'inline' } }, data: { def: { data: {}, actors: {} } } });
    if (!encoded.ok) throw new Error(encoded.sentence);
    document.body.innerHTML = storyPayloadScript(encoded.text);
    const { container } = render(<Make />);
    await waitFor(() => {
      expect(container.querySelector('[data-vzf="dashboard-page-refused"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-vzf="dashboard-page-refused"]')?.textContent).toContain('data');
  });
});
