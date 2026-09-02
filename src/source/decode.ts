/**
 * Format decoders — bytes or a payload in, rows out. Pure; a format never
 * knows a carrier. `rows` must be a list of objects; `csv` is text sniffed
 * into typed rows by the data layer's own parser; `json` is a list of objects,
 * an object carrying `rows`, or — only when the def says `options: { as: 'one-row' }` —
 * one object as one row (a FeatureCollection is one row, not zero; an error
 * envelope is never a table by accident).
 */
import { parseCSVTyped } from '../data/csv.js';
import type { Row } from '../data/types.js';
import type { SourceFormat, SourceRejection } from './types.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function decodeRows(format: SourceFormat, payload: unknown, options: Readonly<Record<string, unknown>> = {}): readonly Row[] | SourceRejection {
  switch (format) {
    case 'rows':
      if (!Array.isArray(payload) || !payload.every(isObject)) return { rejected: 'format rows needs a list of row objects' };
      return payload as Row[];
    case 'csv': {
      if (typeof payload !== 'string') return { rejected: 'format csv needs text' };
      const delimiter = typeof options['delimiter'] === 'string' ? options['delimiter'] : undefined;
      return parseCSVTyped(payload, delimiter !== undefined ? { delimiter } : undefined).rows;
    }
    case 'json': {
      let value: unknown = payload;
      if (typeof payload === 'string') {
        try {
          value = JSON.parse(payload);
        } catch {
          return { rejected: 'format json: the text is not JSON' };
        }
      }
      if (Array.isArray(value)) return value.every(isObject) ? (value as Row[]) : { rejected: 'format json: a list must hold row objects' };
      if (isObject(value) && 'rows' in value) {
        // a payload that says `rows` is judged on what it says — never read as a one-row envelope
        const rows = value['rows'];
        return Array.isArray(rows) && rows.every(isObject) ? (rows as Row[]) : { rejected: 'format json: `rows` must be a list of row objects' };
      }
      if (isObject(value)) {
        // one object as one row is a choice the def states (a FeatureCollection), never a default —
        // an error envelope from a door would otherwise become a one-row table
        if (options['as'] === 'one-row') return [value];
        return { rejected: `format json: an object with keys ${Object.keys(value).join(', ')} is not a table — pass options: { as: 'one-row' } to read it as one row` };
      }
      return { rejected: 'format json: expected a list of rows, an object with rows, or (with options.as) an object' };
    }
  }
}
