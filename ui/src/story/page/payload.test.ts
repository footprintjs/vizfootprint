// @vitest-environment jsdom
/**
 * THE PAYLOAD — what travels, and what is refused rather than attempted.
 *
 * Written as a round trip, because that is the claim: the build writes what
 * the page reads, with one implementation on both sides. The rest is the two
 * ways it can be wrong — a blob that will not unpack, and a blob too big to
 * belong in a file at all.
 */
import { describe, it, expect } from 'vitest';
import {
  STORY_PAYLOAD_CEILING_BYTES,
  STORY_PAYLOAD_ENCODING,
  STORY_PAYLOAD_ID,
  STORY_PAYLOAD_TYPE,
  decodeStoryPayload,
  encodeStoryPayload,
  formatBytes,
  readStoryPayload,
  readStoryPayloadText,
  storyPayloadScript,
  type StoryPayload,
} from './payload.js';

const PAYLOAD: StoryPayload<{ readonly rows: readonly number[] }> = {
  log: [{ id: 's1', parent: null, viewId: 'bar', kind: 'point', field: 'category', value: 'Casual' } as never],
  bookmarks: [{ id: 'b1', name: 'Start', commitId: 's1', by: 'user', at: '2026-09-01T00:00:00.000Z' }],
  saved: [],
  meta: { builtAt: '2026-09-05T00:00:00.000Z', data: { via: 'inline', label: 'ten numbers' } },
  data: { rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
};

const plant = (text: string): Document => {
  document.body.innerHTML = storyPayloadScript(text);
  return document;
};

describe('the payload travels, and comes back the same', () => {
  it('encodes to base64 of gzip, and decodes back to what went in', async () => {
    const out = await encodeStoryPayload(PAYLOAD);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toMatch(/^[A-Za-z0-9+/=]+$/); // the alphabet is why the block needs no escaping
    expect(out.sizes.json).toBeGreaterThan(0);
    expect(out.sizes.ceiling).toBe(STORY_PAYLOAD_CEILING_BYTES);
    const back = await decodeStoryPayload<{ rows: readonly number[] }>(out.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.payload).toEqual(PAYLOAD);
    expect(back.bytes).toBe(out.text.length);
  });

  it('survives a payload bigger than one base64 chunk', async () => {
    // 32 kB is the chunk `toBase64` walks in; a megabyte of rows crosses it many times
    const big: StoryPayload<{ rows: number[] }> = { ...PAYLOAD, data: { rows: Array.from({ length: 200_000 }, (_, i) => i) } };
    const out = await encodeStoryPayload(big);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sizes.json).toBeGreaterThan(1_000_000);
    const back = await decodeStoryPayload<{ rows: number[] }>(out.text);
    expect(back.ok && back.payload.data?.rows.length).toBe(200_000);
  });

  it('REFUSES past the ceiling, with the numbers and the one thing to do instead', async () => {
    const out = await encodeStoryPayload(PAYLOAD, { ceiling: 8 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.sizes.compressed).toBeGreaterThan(8);
    expect(out.sentence).toContain('past the 8 B a single file inlines');
    expect(out.sentence).toContain("via: 'http'");
  });
});

describe('the payload, read off a page', () => {
  it('writes ONE script block a browser never executes, and reads it back', async () => {
    const out = await encodeStoryPayload(PAYLOAD);
    if (!out.ok) throw new Error('encode refused');
    const doc = plant(out.text);
    const block = doc.querySelector(`script#${STORY_PAYLOAD_ID}`);
    expect(block?.getAttribute('type')).toBe(STORY_PAYLOAD_TYPE);
    expect(block?.getAttribute('data-encoding')).toBe(STORY_PAYLOAD_ENCODING);
    expect(readStoryPayloadText(doc)).toBe(out.text);
    const read = await readStoryPayload<{ rows: readonly number[] }>(doc);
    expect(read.ok && read.payload.meta.data.via).toBe('inline');
  });

  it('says so when the page carries no payload at all, and when the block is empty', async () => {
    document.body.innerHTML = '';
    expect(readStoryPayloadText(document)).toBeNull();
    const none = await readStoryPayload(document);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.sentence).toContain('carries no story payload');
    document.body.innerHTML = storyPayloadScript('   ');
    expect(readStoryPayloadText(document)).toBeNull();
  });

  it('refuses a blob that will not unpack, one that is not JSON, and one that is not a story', async () => {
    const notGzip = await decodeStoryPayload('bm90IGd6aXA=');
    expect(notGzip.ok).toBe(false);
    if (!notGzip.ok) expect(notGzip.sentence).toBe("this page's payload could not be unpacked — the block is not gzip in base64");

    const gzipOfNonsense = await encodeStoryPayload({ ...PAYLOAD });
    if (!gzipOfNonsense.ok) throw new Error('encode refused');
    // the same wrapping, around bytes that unpack to text that is not JSON
    const notJson = await decodeStoryPayload(await gzipText('this is not json'));
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.sentence).toContain('not JSON');

    const noLog = await decodeStoryPayload(await gzipText('{"meta":{}}'));
    expect(noLog.ok).toBe(false);
    if (!noLog.ok) expect(noLog.sentence).toContain('carries no log');

    const notAnObject = await decodeStoryPayload(await gzipText('42'));
    expect(notAnObject.ok).toBe(false);
  });
});

describe('bytes, as a person reads them', () => {
  it('counts in B, kB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(20_480)).toBe('20 kB');
    expect(formatBytes(3_145_728)).toBe('3.00 MB');
  });
});

/** gzip+base64 of arbitrary text, through the same platform stream the encoder uses. */
async function gzipText(text: string): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream('gzip') as never).getReader();
  let binary = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const byte of value as Uint8Array) binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
