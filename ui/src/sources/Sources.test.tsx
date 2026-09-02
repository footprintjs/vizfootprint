// @vitest-environment jsdom
/**
 * The Sources tab renders what the def declared, what the carrier vouched
 * for, and what the journal recorded — in words — and opens its doors only
 * when the host brought one and the cockpit is not read-only.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Sources, lastAnswer, sourceWords, grainWords, outcomeWords } from './Sources.js';
import type { RefreshDeltaView, RefreshRecordView, TableView } from '../adapter/types.js';

const TABLES: TableView[] = [
  { name: 'cells', source: { format: 'rows', via: 'inline' }, engine: 'memory', key: 'id', absence: { field: 'state', states: ['present', 'unknown'] }, grain: { bucket: 'week', reducer: 'sum', note: 'weekly totals' }, declaredColumns: 2 },
  { name: 'plain', source: { inline: 'rows', rows: 40 }, engine: 'memory', declaredColumns: 0 },
  { name: 'remote', source: { format: 'csv', via: 'http', at: 'https://x/y.csv' }, engine: 'wasm', declaredColumns: 1 },
];
const JOURNAL: RefreshRecordView[] = [
  { at: '10:00', asked: ['cells', 'remote'], tables: { cells: { unchanged: true, version: 'v1' }, remote: { refused: true, reason: 'unavailable', message: '503 from the carrier' } } },
  { at: '11:00', asked: ['remote'], tables: { remote: { changed: true, from: 'v1', to: 'v2', retrievedAt: '11:00', rows: 12, delta: { keyed: true, key: 'id', added: 2, updated: 3, removed: 0, unkeyed: 1 }, materialisedLost: ['cluster_id'] } } },
];

describe('Sources', () => {
  it('renders every table with its facts in words, the provenance where a source vouched, and the latest journal answer', () => {
    const { container } = render(<Sources tables={TABLES} sources={{ cells: { format: 'rows', via: 'inline', version: 'v1', retrievedAt: '09:00', rows: 90300 } }} columns={{ cells: [{ field: 'id', type: 'string' }, { field: 'cases', type: 'number' }] }} journal={JOURNAL} checks={[]} />);
    expect(container.querySelector('.vzf-sources-count')!.textContent).toBe('3 tables declared');
    const cells = container.querySelector('[aria-label="table cells"]')!;
    expect(cells.textContent).toContain('rows via inline');
    expect(cells.textContent).toContain('90,300 rows · version v1 · read 09:00');
    expect(cells.textContent).toContain('per week · sum over the bucket · weekly totals');
    expect(cells.textContent).toContain('state speaks present · unknown');
    expect(cells.textContent).toContain('10:00 · unchanged · version v1');
    expect(cells.textContent).toContain('2 declared · 2 listed by the engine');
    expect(cells.querySelectorAll('.vzf-sources-columns li')).toHaveLength(2);
    const plain = container.querySelector('[aria-label="table plain"]')!;
    expect(plain.textContent).toContain('40 inline rows carried by the definition');
    expect(plain.textContent).toContain('no version to move');
    expect(plain.textContent).toContain('a refresh replaces the table; no row is addressable');
    expect(plain.textContent).toContain('present by construction');
    expect(plain.textContent).toContain('never asked');
    const remote = container.querySelector('[aria-label="table remote"]')!;
    expect(remote.textContent).toContain('csv via http · https://x/y.csv');
    expect(remote.textContent).toContain('11:00 · changed · v1 → v2 · 12 rows · by id: added 2 · updated 3 · removed 0 · 1 rows without a usable key');
    expect(remote.textContent).toContain('lost with the old rows: cluster_id — re-run the analysis');
    expect(remote.querySelector('.vzf-sources-badge')!.textContent).toBe('wasm');
    expect(container.querySelector('.vzf-sources-checks')!.textContent).toContain('the declarations agree with the data');
    expect(container.querySelector('.vzf-sources-refresh')).toBeNull(); // no door brought
    expect(container.querySelector('[role="status"]')!.textContent).toBe(''); // an old answer is never announced at first paint
  });

  it('the doors: refresh all and refresh one call the host with the right tables and carry accessible names; read-only and in-flight disable them; checks list sentences or say why they could not be read', () => {
    const onRefresh = vi.fn();
    const { container, rerender } = render(<Sources tables={TABLES} onRefresh={onRefresh} checks={['data["plain"] declares no key']} />);
    fireEvent.click(container.querySelector('.vzf-sources-head .vzf-sources-refresh')!);
    expect(onRefresh).toHaveBeenLastCalledWith();
    const cellsButton = container.querySelector('[aria-label="table cells"] button')!;
    expect(cellsButton.getAttribute('aria-label')).toBe('refresh cells');
    fireEvent.click(cellsButton);
    expect(onRefresh).toHaveBeenLastCalledWith(['cells']);
    expect(container.querySelector('[aria-label="table plain"] button')).toBeNull(); // inline rows have no door: nothing to re-read
    expect(container.querySelector('.vzf-sources-check-list')!.textContent).toBe('data["plain"] declares no key');
    expect(container.querySelector('.vzf-sources-check-list')!.getAttribute('aria-labelledby')).toBe('vzf-sources-checks-label');
    rerender(<Sources tables={TABLES} onRefresh={onRefresh} refreshing />);
    expect(container.querySelector('.vzf-sources-head .vzf-sources-refresh')!.textContent).toBe('refreshing…');
    expect(container.querySelector('.vzf-sources-head .vzf-sources-refresh')!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(container.querySelector('.vzf-sources-head .vzf-sources-refresh')!);
    expect(onRefresh).toHaveBeenCalledTimes(2); // a waiting door keeps focus but does not fire
    expect(container.querySelector('[role="status"]')!.textContent).toBe('refreshing');
    expect(cellsButton.textContent).toBe('…');
    rerender(<Sources tables={TABLES} onRefresh={onRefresh} journal={JOURNAL} />);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('refresh at 11:00: remote changed'); // announced once a refresh ran while open
    expect(cellsButton.getAttribute('aria-label')).toBe('refresh cells'); // the name survives the in-flight label
    rerender(<Sources tables={TABLES} onRefresh={onRefresh} readOnly />);
    expect(container.querySelector('.vzf-sources-head .vzf-sources-refresh')!.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('.vzf-sources-checks')!.textContent).toContain('not asked yet');
    rerender(<Sources tables={TABLES} checks={['stale']} checksError="503 from the door" />);
    expect(container.querySelector('.vzf-sources-checks')!.textContent).toContain('the checks could not be read: 503 from the door'); // a refusal is never "not asked yet"
  });

  it('no table declared says so; a wide table caps its column list; the helpers speak plainly, including the unkeyed replace', () => {
    const { container } = render(<Sources tables={[]} className="x" />);
    expect(container.querySelector('.vzf-sources.x .vzf-sources-count')!.textContent).toBe('no table declared');
    expect(render(<Sources tables={[TABLES[1]!]} />).container.querySelector('.vzf-sources-count')!.textContent).toBe('1 table declared');
    const wide = render(<Sources tables={[TABLES[1]!]} columns={{ plain: Array.from({ length: 45 }, (_, i) => ({ field: `c${i}`, type: 'number' })) }} />).container;
    expect(wide.querySelectorAll('.vzf-sources-columns li')).toHaveLength(41);
    expect(wide.querySelector('.vzf-sources-columns li:last-child')!.textContent).toBe('+5 more');
    expect(render(<Sources tables={[{ name: 'odd', source: { unstated: true }, engine: 'memory', declaredColumns: 0 }]} />).container.textContent).toContain('not stated — the wire carried no readable source');
    expect(lastAnswer(JOURNAL, 'cells')).toEqual({ at: '10:00', outcome: { unchanged: true, version: 'v1' } });
    expect(lastAnswer(JOURNAL, 'nobody')).toBeNull();
    expect(sourceWords({ inline: 'csv' })).toBe('CSV text carried by the definition');
    expect(sourceWords({ inline: 'rows' })).toBe('0 inline rows carried by the definition');
    expect(sourceWords({ format: 'json', via: 'file' })).toBe('json via file');
    expect(grainWords({})).toBe('stated, without detail');
    expect(grainWords({ collapsedFrom: 5 })).toBe('collapsed from 5');
    const changed = (delta: RefreshDeltaView) => render(<>{outcomeWords({ changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 1, delta })}</>).container.textContent;
    expect(changed({ keyed: true, key: 'id', added: 1, updated: 0, removed: 0, unkeyed: 0 })).toBe('changed · a → b · 1 rows · by id: added 1 · updated 0 · removed 0');
    expect(changed({ keyed: false, replaced: 90300, keyAbsent: 'id' })).toBe('changed · a → b · 1 rows · replaced 90,300 rows — the declared key id names no column in the new rows; no row is addressable');
    expect(changed({ keyed: false, replaced: 7 })).toBe('changed · a → b · 1 rows · replaced 7 rows — no row key, so no delta');
    expect(render(<>{outcomeWords({ refused: true, reason: 'timeout', message: 'slow' })}</>).container.textContent).toBe('refused · timeout — slow');
    expect(render(<>{outcomeWords({ unreadable: true })}</>).container.textContent).toBe('an answer the wire could not carry');
    // beyond the tail a table is "no answer in the latest N", never "never asked"; an empty journal with no total is "never asked"
    const tail = render(<Sources tables={[TABLES[0]!]} journal={JOURNAL} journalTotal={80} />).container;
    expect(tail.textContent).toContain('10:00 · unchanged'); // cells has an answer in the tail
    const beyond = render(<Sources tables={[TABLES[1]!]} journal={JOURNAL} journalTotal={80} />).container;
    expect(beyond.textContent).toContain('no answer in the latest 2 refreshes');
    expect(render(<Sources tables={[TABLES[1]!]} journal={JOURNAL} journalTotal={2} />).container.textContent).toContain('never asked');
    expect(render(<Sources tables={[TABLES[1]!]} />).container.querySelector('[role="status"]')!.textContent).toBe('');
    const mixed: RefreshRecordView = { at: '12:00', asked: ['a', 'b', 'c', 'd'], tables: { a: { unchanged: true, version: 'v' }, b: { refused: true, reason: 'timeout', message: 'slow' }, c: { changed: true, from: 'a', to: 'b', retrievedAt: 't', rows: 1, delta: { keyed: false, replaced: 1 } }, d: { unreadable: true } } };
    const spoken = render(<Sources tables={[]} journal={[]} refreshing />);
    spoken.rerender(<Sources tables={[]} journal={[mixed]} />);
    expect(spoken.container.querySelector('[role="status"]')!.textContent).toBe('refresh at 12:00: a unchanged, b refused, c changed, d unreadable');
  });
});
