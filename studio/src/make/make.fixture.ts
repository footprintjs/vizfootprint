/**
 * THE SUITE'S SPREADSHEET — six rows a person might actually paste.
 *
 * Small on purpose and shaped like the thing the wizard exists for: a text
 * column to put bars on, an ISO date column that a CSV sniffs as a STRING (so
 * declaring it a date is a real act with a real consequence, which is step
 * two's whole point), a number column with two blanks in it, and a column
 * carrying why those blanks are blank.
 *
 * Everything here is used by the tests beside it; there is no unexercised
 * convenience in this file, because this workspace's coverage gate is the
 * library's and a fixture is not exempt from it.
 */
import type { MakeDraft, MakeView } from './types.js';
import { MAKE_TABLE } from './steps.js';

export const SALES_CSV = `region,quarter,sales,report_state
North,2026-01-01,120,present
South,2026-01-01,,unavailable
North,2026-04-01,150,present
South,2026-04-01,90,present
East,2026-01-01,60,present
East,2026-04-01,,unknown
`;

/** The two charts the suite builds: a bar on a category, and a line of a measure over the declared date. */
export const BARS: MakeView = { id: 'regions', label: 'Sales by region', chartKind: 'bar', bindings: { category: 'region' } };
export const LINE: MakeView = { id: 'quarters', label: 'Sales by quarter', chartKind: 'line', bindings: { x: 'quarter', y: 'sales' } };

/**
 * The draft as it stands at the end of step three: every column declared, the
 * absence vocabulary named, two charts bound, and the dashboard's own words.
 *
 * `quarter` is declared a DATE over a sniff that said string — the declaration
 * winning over the sniff is what makes the line chart legal.
 */
export function salesDraft(overrides: Partial<MakeDraft> = {}): MakeDraft {
  return {
    table: MAKE_TABLE,
    csv: SALES_CSV,
    columns: [
      { name: 'region', type: 'string', role: 'dimension', label: 'the region' },
      { name: 'quarter', type: 'date', role: 'dimension' },
      { name: 'sales', type: 'number', role: 'measure' },
      { name: 'report_state', type: 'string' },
    ],
    absence: { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
    views: [BARS, LINE],
    analysis: null,
    title: 'Sales, quarter by quarter',
    caption: 'What each region sold, and which silences are which.',
    ...overrides,
  };
}
