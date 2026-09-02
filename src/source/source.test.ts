/**
 * The data-source layer — decoders, the inline and file carriers, and
 * `openSource`. The file carrier reads a temp directory this test writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeRows, inlineSource, inlineVersion, openSource, SOURCE_FORMATS, SOURCE_VIAS } from './index.js';
import { fileSource } from './file.js';

describe('decodeRows — a format never knows a carrier', () => {
  it('rows: a list of row objects passes through; anything else is refused', () => {
    expect(decodeRows('rows', [{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(decodeRows('rows', 'a,b')).toEqual({ rejected: 'format rows needs a list of row objects' });
    expect(decodeRows('rows', [1, 2])).toEqual({ rejected: 'format rows needs a list of row objects' });
  });
  it('csv: text is sniffed into typed rows; a delimiter option is honoured; non-text is refused', () => {
    expect(decodeRows('csv', 'a,b\n1,x\n2,y')).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(decodeRows('csv', 'a;b\n1;x', { delimiter: ';' })).toEqual([{ a: 1, b: 'x' }]);
    expect(decodeRows('csv', 42)).toEqual({ rejected: 'format csv needs text' });
  });
  it('json: a list, an object with rows, an object as one row, and text of any of those', () => {
    expect(decodeRows('json', [{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(decodeRows('json', { rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(decodeRows('json', '[{"a":3}]')).toEqual([{ a: 3 }]);
    expect(decodeRows('json', 'not json')).toEqual({ rejected: 'format json: the text is not JSON' });
    expect(decodeRows('json', [1])).toEqual({ rejected: 'format json: a list must hold row objects' });
    expect(decodeRows('json', '5')).toEqual({ rejected: 'format json: expected a list of rows, an object with rows, or (with options.as) an object' });
  });
  it('json: one object is one row only when the def says so; a payload that says rows is judged on what it says', () => {
    const fc = { type: 'FeatureCollection', features: [] };
    expect(decodeRows('json', fc, { as: 'one-row' })).toEqual([fc]);
    expect(decodeRows('json', { error: 'rate limited' })).toEqual({ rejected: "format json: an object with keys error is not a table — pass options: { as: 'one-row' } to read it as one row" });
    expect(decodeRows('json', { rows: [1, 2] })).toEqual({ rejected: 'format json: `rows` must be a list of row objects' });
    expect(decodeRows('json', { rows: 'nope' }, { as: 'one-row' })).toEqual({ rejected: 'format json: `rows` must be a list of row objects' });
  });
  it('the vocabularies are the three formats and the three carriers', () => {
    expect(SOURCE_FORMATS).toEqual(['rows', 'csv', 'json']);
    expect(SOURCE_VIAS).toEqual(['inline', 'file', 'http']);
  });
});

describe('inlineSource — the payload is the def itself', () => {
  it('decodes text, a list, or an object; the version is the payload size and a content hash', async () => {
    const text = await (await inlineSource.open({ format: 'csv', via: 'inline', at: 'a\n1\n2' }, { table: 't' })).snapshot();
    expect(text.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(text.version).toMatch(/^inline:5-[0-9a-f]{8}$/);
    expect(text.version).toBe(inlineVersion('a\n1\n2'));
    const list = await (await inlineSource.open({ format: 'rows', via: 'inline', at: [{ a: 1 }] }, { table: 't' })).snapshot();
    expect(list.version).toBe(inlineVersion([{ a: 1 }]));
    expect(inlineVersion([{ a: 1 }])).not.toBe(inlineVersion([{ a: 9 }])); // same size, different bytes, different version
    const obj = await inlineSource.open({ format: 'json', via: 'inline', at: { rows: [{ a: 1 }] } }, { table: 't' });
    expect((await obj.snapshot()).version).toBe(inlineVersion({ rows: [{ a: 1 }] }));
    expect(obj.capabilities).toEqual({ live: false, pushdown: false });
    expect(typeof (await obj.snapshot()).retrievedAt).toBe('string');
    await obj.close();
  });
  it('a payload the format refuses is refused at open, with the format sentence', async () => {
    await expect(inlineSource.open({ format: 'rows', via: 'inline', at: 'nope' }, { table: 't' })).rejects.toThrow('table "t" inline source: format rows needs a list of row objects');
  });
});

describe('fileSource — a path or file URL read by this process', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vf-source-'));
    await writeFile(join(dir, 'cells.csv'), 'state,cases\nOhio,3\nIowa,\n');
    await writeFile(join(dir, 'geo.json'), JSON.stringify({ type: 'FeatureCollection', features: [{ id: 1 }] }));
    await writeFile(join(dir, 'rows.json'), JSON.stringify([{ a: 1 }, { a: 2 }]));
    await writeFile(join(dir, 'bad-rows.json'), JSON.stringify({ a: 1 }));
    await writeFile(join(dir, 'not.json'), 'a,b\n1,2');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads CSV by path; the version is what the file system vouches for', async () => {
    const h = await fileSource.open({ format: 'csv', via: 'file', at: join(dir, 'cells.csv') }, { table: 'cells' });
    const snap = await h.snapshot();
    expect(snap.rows).toEqual([{ state: 'Ohio', cases: 3 }, { state: 'Iowa', cases: null }]);
    expect(snap.version).toMatch(/^mtime:\d{4}-.*;size:\d+$/);
    expect(h.capabilities).toEqual({ live: false, pushdown: false });
    await h.close();
  });
  it('reads a file URL; a JSON object is one row when the def says so (a FeatureCollection is one row, not zero)', async () => {
    const h = await fileSource.open({ format: 'json', via: 'file', at: pathToFileURL(join(dir, 'geo.json')).href, options: { as: 'one-row' } }, { table: 'geo' });
    const snap = await h.snapshot();
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]!['type']).toBe('FeatureCollection');
    const bare = await fileSource.open({ format: 'json', via: 'file', at: join(dir, 'geo.json') }, { table: 'geo' });
    await expect(bare.snapshot()).rejects.toThrow(/^table "geo" file source .*geo\.json: format json: an object with keys type, features is not a table/);
  });
  it('honours an abort signal on the read', async () => {
    const h = await fileSource.open({ format: 'csv', via: 'file', at: join(dir, 'cells.csv') }, { table: 'cells' });
    await expect(h.snapshot({ signal: AbortSignal.abort() })).rejects.toThrow(/cancelled — the read was aborted/);
  });
  it('format rows over a file parses the JSON text as the list; a non-list is refused with the path', async () => {
    const ok = await fileSource.open({ format: 'rows', via: 'file', at: join(dir, 'rows.json') }, { table: 'r' });
    expect((await ok.snapshot()).rows).toEqual([{ a: 1 }, { a: 2 }]);
    const bad = await fileSource.open({ format: 'rows', via: 'file', at: join(dir, 'bad-rows.json') }, { table: 'r' });
    await expect(bad.snapshot()).rejects.toThrow(/^table "r" file source .*bad-rows\.json: format rows needs a list of row objects$/);
    const notJson = await fileSource.open({ format: 'rows', via: 'file', at: join(dir, 'not.json') }, { table: 'r' });
    await expect(notJson.snapshot()).rejects.toThrow(/^table "r" file source .*not\.json: format rows needs a JSON list of row objects, and the file is not JSON$/);
  });
  it('`at` must be a path or a file URL', async () => {
    await expect(fileSource.open({ format: 'csv', via: 'file' }, { table: 'x' })).rejects.toThrow('table "x" file source: `at` must be a path or a file URL');
    await expect(fileSource.open({ format: 'csv', via: 'file', at: '' }, { table: 'x' })).rejects.toThrow('table "x" file source: `at` must be a path or a file URL');
  });
  it('openSource routes by `via`: inline is always known, file needs the adapter passed in', async () => {
    const inline = await openSource({ format: 'rows', via: 'inline', at: [{ a: 1 }] }, 't');
    expect((await inline.snapshot()).rows).toEqual([{ a: 1 }]);
    const file = await openSource({ format: 'csv', via: 'file', at: join(dir, 'cells.csv') }, 'cells', [fileSource]);
    expect((await file.snapshot()).rows).toHaveLength(2);
    await expect(openSource({ format: 'csv', via: 'file', at: join(dir, 'cells.csv') }, 'cells')).rejects.toThrow(
      'table "cells" declares a source via file, and no adapter for file was passed — import the file carrier (the library\'s source/file module) and pass it in `sources`',
    );
  });
});
