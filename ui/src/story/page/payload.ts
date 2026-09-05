/**
 * THE PAYLOAD — what one HTML file carries, and how it gets in and out.
 *
 * This module is the door `vizfootprint-ui/story/payload`, and it is its own
 * door for one reason: a BUILD writes what a PAGE reads, so both need this
 * code, and only one of them can load a renderer. `vizfootprint-ui/story/page`
 * pulls React and storydeck; a Vite config runs in plain Node, where storydeck's
 * bundler-only ESM does not even resolve. Splitting the codec off is the same
 * rule the library states for its node carrier: a subpath is for a symbol whose
 * presence on the barrel would change what the barrel costs to load.
 *
 * A story page is ONE file a person can send or drop on a static host. The
 * engine, the charts and the scroll lens are code and are bundled; everything
 * else the page needs is DATA, and data has to travel in the document itself.
 * That is what this module is: the encoder that puts it there, the decoder that
 * reads it back, and the one ceiling past which inlining is refused rather than
 * attempted.
 *
 * Four decisions, each with its reason:
 *
 *   • **A script block, not a JavaScript literal.** The payload is inert text
 *     in a `<script type="application/…">` the browser never executes, so
 *     nothing in a log, a bookmark's name or a table's rows can become code.
 *   • **gzip, then base64.** A dashboard's rows are the biggest thing in the
 *     file and they compress an order of magnitude; base64 is what makes the
 *     compressed bytes survive being written into HTML. The alphabet is
 *     `A-Za-z0-9+/=` — no `<`, no `&`, no quote — so the block needs no
 *     escaping and cannot end itself early. That is a property of the
 *     encoding, not a promise this module keeps by hand.
 *   • **`DecompressionStream('gzip')`, which is the platform's.** No library
 *     ships in the page to read it: every browser that can run the page has
 *     had the API since 2023, and Node has had it since 18. One
 *     implementation, both sides of the build.
 *   • **A ceiling, and a refusal.** Past {@link STORY_PAYLOAD_CEILING_BYTES}
 *     compressed, {@link encodeStoryPayload} REFUSES with a sentence naming
 *     what to do instead — declare the table `via: 'http'` beside the page —
 *     rather than emitting a file no browser will open. It is judged before
 *     anything is written, like every other refusal in this library.
 *
 * Nothing here touches React, the DOM (except the one reader that takes a
 * document as an argument), or a session. Given a payload the answers are the
 * same every time, which is what lets a build script and a browser share them.
 */
import type { CommitRecord } from 'vizfootprint/log';
import type { RestorableBookmark, RestorableSaved } from 'vizfootprint/session';

/** The id of the one script block a story page carries its payload in. */
export const STORY_PAYLOAD_ID = 'vzf-story-payload';

/** Its MIME type — a type no browser executes, so the payload is data and stays data. */
export const STORY_PAYLOAD_TYPE = 'application/vnd.vizfootprint.story+json';

/** How the bytes in the block are wrapped, stated on the block itself so a reader never has to guess. */
export const STORY_PAYLOAD_ENCODING = 'gzip;base64';

/**
 * The most COMPRESSED bytes a page will inline: ten megabytes.
 *
 * It is a ceiling on the compressed size because that is what the file
 * actually costs to send. Past it a single-file page stops being the thing it
 * is for — something you can mail — and the honest answer is to leave the
 * table where it lives and declare it `via: 'http'` beside the page.
 */
export const STORY_PAYLOAD_CEILING_BYTES = 10 * 1024 * 1024;

/** Where the page's data came from, as the page states it in its own front matter. */
export interface StoryDataNote {
  /** `inline` — the bytes are in this file; `http`/`file` — the def fetches them from `at`. */
  readonly via: 'inline' | 'http' | 'file';
  /** Where they are fetched from, when they are not inline. */
  readonly at?: string;
  /** What the page says its data is, in the host's own words ("the CDC snapshot, 90,300 cells"). */
  readonly label?: string;
}

/** What the page says about itself, above the story. */
export interface StoryPayloadMeta {
  /** The page's title — the host's, not the story's (the story titles itself from the dashboard's words). */
  readonly title?: string;
  /** When the build ran, ISO. A fact about the FILE, never about any act on the log. */
  readonly builtAt: string;
  /** Where the data came from — printed in the front matter. */
  readonly data: StoryDataNote;
  /**
   * Anything the host must say out loud about what it could NOT vouch for.
   * Printed under the front matter verbatim. A host with nothing to admit
   * leaves it out; a host that stamped something it did not read off its own
   * source says so here rather than letting the page imply otherwise.
   */
  readonly notes?: readonly string[];
}

/**
 * Everything a page carries that is not code.
 *
 * `data` is the HOST's own shape and this module never looks inside it: a def
 * is code (its analyses have a `run()`), so the page entry imports the def and
 * builds it from whatever this slot holds — a CSV, a bundle of tables, nothing
 * at all when the def fetches its own. Typing it here would be this module
 * guessing at a dashboard it has never seen.
 */
export interface StoryPayload<Data = unknown> {
  /** The TRACE, verbatim — what `session.replay` takes. */
  readonly log: readonly CommitRecord[];
  /** The bookmarks, whole records: a story is the beats a person NAMED, and no log carries them. */
  readonly bookmarks: readonly RestorableBookmark[];
  /** The saved pictures. They restore BEFORE the replay: words that cite one are refused when it is not there yet. */
  readonly saved?: readonly RestorableSaved[];
  readonly meta: StoryPayloadMeta;
  readonly data?: Data;
}

/** What one encoding cost, in bytes — printed at build time so a host sees the file it is making. */
export interface StoryPayloadSizes {
  /** The payload as JSON. */
  readonly json: number;
  /** After gzip — the number the ceiling is about. */
  readonly compressed: number;
  /** After base64, which is what actually lands in the file. */
  readonly inlined: number;
  /** The ceiling it was judged against. */
  readonly ceiling: number;
}

/** Encoded, or refused — judged against the ceiling before a byte is written. */
export type StoryPayloadEncoded =
  | { readonly ok: true; readonly text: string; readonly sizes: StoryPayloadSizes }
  | { readonly ok: false; readonly sentence: string; readonly sizes: StoryPayloadSizes };

/**
 * Decoded, or refused in the words of what went wrong — a page read off a wire
 * is data, and data can be wrong.
 *
 * `bytes` is the encoded text's own length: what this payload COSTS where it
 * was read from. It rides out with the payload because the only place that can
 * measure it is the place that read it, and the page prints it in its front
 * matter.
 */
export type StoryPayloadDecoded<Data = unknown> =
  | { readonly ok: true; readonly payload: StoryPayload<Data>; readonly bytes: number }
  | { readonly ok: false; readonly sentence: string };

/** Bytes as a person reads them — the front matter's unit, and the build's. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} kB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** base64 in chunks: `String.fromCharCode(...bytes)` on a megabyte-long array overflows the argument stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Push bytes through one of the platform's compression streams and collect what
 * comes out.
 *
 * A stream and a reader, and nothing else: `Blob.stream()` and `Response` would
 * both be shorter, and neither is available everywhere this code has to run
 * (jsdom, where the tests live, has a `Blob` with no `stream()`). The build
 * writes what the page reads, so the two must be running the SAME code — which
 * means the code may only use what the smallest of its runtimes has.
 */
async function through(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The payload → the text of the script block, and what it cost.
 *
 * Refused, with the sizes still measured, when the compressed bytes are past
 * the ceiling: the host is told the number, the ceiling, and the one thing to
 * do about it.
 *
 * `ceiling` is the host's to lower and not to raise in spirit: a page meant to
 * travel as an attachment has a smaller budget than {@link
 * STORY_PAYLOAD_CEILING_BYTES}, and the refusal should say the number that
 * actually applies rather than one nobody is holding to.
 */
export async function encodeStoryPayload<Data>(payload: StoryPayload<Data>, options: { readonly ceiling?: number } = {}): Promise<StoryPayloadEncoded> {
  const ceiling = options.ceiling ?? STORY_PAYLOAD_CEILING_BYTES;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const gz = await through(bytes, new CompressionStream('gzip'));
  const text = toBase64(gz);
  const sizes: StoryPayloadSizes = { json: bytes.length, compressed: gz.length, inlined: text.length, ceiling };
  if (gz.length > ceiling) {
    return {
      ok: false,
      sizes,
      sentence:
        `this page's data is ${formatBytes(gz.length)} compressed, past the ${formatBytes(ceiling)} a single file inlines — ` +
        'leave the table where it is and declare it `via: \'http\'` beside the page, so the file carries the story and fetches the rows',
    };
  }
  return { ok: true, text, sizes };
}

/** The text of the block → the payload, or the sentence that says why not. */
export async function decodeStoryPayload<Data = unknown>(text: string): Promise<StoryPayloadDecoded<Data>> {
  const bytes = text.length;
  let json: string;
  try {
    json = new TextDecoder().decode(await through(fromBase64(text.trim()), new DecompressionStream('gzip')));
  } catch {
    // The two ways this throws are the two ways the block can be wrong, and neither
    // has a message worth passing on ("incorrect header check" is machinery): the
    // text is not base64, or the bytes under it are not gzip. Say that, and stop.
    return { ok: false, sentence: 'this page\'s payload could not be unpacked — the block is not gzip in base64' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, sentence: 'this page\'s payload unpacked, but it is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { log?: unknown }).log)) {
    return { ok: false, sentence: 'this page\'s payload is not a story: it carries no log' };
  }
  return { ok: true, payload: parsed as StoryPayload<Data>, bytes };
}

/**
 * The script block, ready to write into the document's `<body>`.
 *
 * No escaping: base64's alphabet has no `<`, so the block cannot end itself,
 * and the type is one no browser executes.
 */
export function storyPayloadScript(encoded: string): string {
  return `<script id="${STORY_PAYLOAD_ID}" type="${STORY_PAYLOAD_TYPE}" data-encoding="${STORY_PAYLOAD_ENCODING}">${encoded}</script>`;
}

/** The block's text, off a live document — `null` when this page carries none. */
export function readStoryPayloadText(root: Pick<Document, 'querySelector'>): string | null {
  const block = root.querySelector(`script#${STORY_PAYLOAD_ID}`);
  const text = block?.textContent ?? '';
  return text.trim().length === 0 ? null : text;
}

/** The page's own payload, decoded — or the sentence that says what is wrong with it. */
export async function readStoryPayload<Data = unknown>(root: Pick<Document, 'querySelector'>): Promise<StoryPayloadDecoded<Data>> {
  const text = readStoryPayloadText(root);
  if (text === null) return { ok: false, sentence: `this page carries no story payload (no <script id="${STORY_PAYLOAD_ID}">)` };
  return decodeStoryPayload<Data>(text);
}
