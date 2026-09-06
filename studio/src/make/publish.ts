/**
 * PUBLISH — the desk on screen becomes one HTML file, or it is refused.
 *
 * ## Why a copy of THIS page, and not a build
 *
 * A story page is a build (`vizfootprint-ui/story/page`, "Why it is a BUILD and
 * not a button in the cockpit"): a definition whose analyses are code cannot
 * ride in a script block, so a host entry has to import it and a bundler has to
 * bundle it. A MADE definition has no code in it — that is the whole point of
 * the builtin-record form — so it CAN ride in the block. What still cannot is
 * the engine, the charts and React.
 *
 * They do not have to: they are already here. The wizard is running inside a
 * page that carries every one of them, so the file it publishes is **this same
 * page with a payload block in it and its mount emptied**. Opening that file,
 * the same bundle finds a payload where it found none, and becomes the desk it
 * made rather than the wizard that made it. One program, two roles, decided by
 * what is in the document.
 *
 * ## …which is only true when the page IS one file
 *
 * A page whose code lives in `assets/index-abc123.js` copies as a page whose
 * code lives in a file that is not being copied. So {@link publishRefusal}
 * looks, and REFUSES in a sentence naming what it found, rather than handing
 * someone a file that opens blank on a machine with no server. That is the
 * ordinary law of this library applied to itself: a refusal is a sentence
 * naming the thing, and a page that says what it carries has to be able to.
 */
import { STORY_PAYLOAD_ID, storyPayloadScript, type StoryPayload } from 'vizfootprint-ui/story/payload';
import type { DashboardDef } from 'vizfootprint/def';
import type { InteractionSession } from 'vizfootprint/session';
import type { MadeData } from './types.js';

/** The name the browser offers to save the published page under. */
export const MADE_FILENAME = 'dashboard.html';

/**
 * Every stylesheet and script this document loads from SOMEWHERE ELSE — the
 * files a copy of it would not bring along. A `data:` URI is not somewhere
 * else: it is in the document.
 */
export function externalResources(doc: Document): readonly string[] {
  const out: string[] = [];
  const collect = (selector: string, attribute: string): void => {
    for (const el of doc.querySelectorAll(selector)) {
      // the selector asks for the attribute, so it is there — a `?? ''` here
      // would be a fallback that can never fire, which is a lie about the code
      const url = el.getAttribute(attribute)!;
      if (!url.startsWith('data:')) out.push(url);
    }
  };
  collect('script[src]', 'src');
  collect('link[rel="stylesheet"][href]', 'href');
  return out;
}

/**
 * Why this page may not be published, or `null` when it may.
 *
 * The refusal names the files, because "it would not work" is not something a
 * person can act on and "your code is in these three files" is.
 */
export function publishRefusal(doc: Document): string | null {
  const outside = externalResources(doc);
  if (outside.length === 0) return null;
  return `this wizard is running on a page that loads its code from ${String(outside.length)} other ${outside.length === 1 ? 'file' : 'files'} (${outside.join(', ')}), so a copy of this page would open blank — publish from a page built as ONE file (that is what vite-plugin-singlefile is for), and everything the desk needs will already be in it`;
}

/**
 * This document, as the file to hand over: the mount emptied, any payload it
 * was itself opened with replaced, and the new one written in.
 *
 * The mount is emptied because what is in it right now is the WIZARD — a
 * rendered DOM that the published page's own React would throw away on its
 * first paint, after a reader had already seen it.
 */
export function publishedHtml(doc: Document, payloadText: string, mountId: string): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  const mount = root.querySelector(`#${mountId}`);
  if (mount !== null) mount.replaceChildren();
  const already = root.querySelector(`script#${STORY_PAYLOAD_ID}`);
  if (already !== null) already.remove();
  const body = root.querySelector('body');
  // base64's alphabet has no `<`, so the block cannot end itself early — the
  // codec's own property, and the reason `storyPayloadScript` is text
  (body ?? root).insertAdjacentHTML('beforeend', storyPayloadScript(payloadText));
  return `<!doctype html>\n${root.outerHTML}\n`;
}

/** What the published page needs told about itself, beside the definition it carries. */
export interface MadePublish {
  /** The definition the desk was built from — DATA, which is why it can ride in the block at all. */
  readonly def: DashboardDef;
  /** The live session: its acts are the page's log, its bookmarks its beats, its pictures its saved logic. */
  readonly session: InteractionSession;
  /** How many rows the table holds — said in the front matter, measured rather than written down. */
  readonly rows: number;
  /** The day the file was made. */
  readonly builtAt: string;
}

/** The dashboard's own declared title, when it declared one — what the published page names itself. */
export function declaredTitle(def: DashboardDef): string | undefined {
  const slots = def.prose?.find((p) => p.viewId === 'dashboard')?.slots;
  const text = slots?.title?.text;
  return text === undefined || text.trim().length === 0 ? undefined : text;
}

/**
 * Everything the file carries that is not code: the trace, the beats, the saved
 * pictures, and — the part a made desk can do and a hand-written one cannot —
 * its own definition.
 */
export function madePayload(input: MadePublish): StoryPayload<MadeData> {
  const title = declaredTitle(input.def);
  return {
    log: input.session.commits('anywhere'),
    bookmarks: input.session.bookmarks().map((b) => ({ ...b })),
    saved: input.session.saved().map((s) => ({ ...s })),
    meta: {
      ...(title === undefined ? {} : { title }),
      builtAt: input.builtAt,
      data: { via: 'inline', label: `${input.rows.toLocaleString('en-US')} rows and the definition this desk was made from` },
    },
    data: { def: input.def },
  };
}

/**
 * Hand the file to the person.
 *
 * A blob and an anchor, and nothing else — a page that opens from `file://` is
 * a page that had better not need an upload endpoint to be born.
 */
export function downloadHtml(doc: Document, html: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
