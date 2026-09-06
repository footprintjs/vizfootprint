// @vitest-environment jsdom
/**
 * PUBLISH — a copy of this page, or a sentence saying why it would not open.
 *
 * The refusal is the part worth testing hardest: publishing a page whose code
 * lives in three other files produces a file that opens blank, on somebody
 * else's machine, with nothing to read. So the check is over a real document,
 * with real `<script src>` elements in it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { STORY_PAYLOAD_ID, decodeStoryPayload } from 'vizfootprint-ui/story/payload';
import { MADE_FILENAME, declaredTitle, downloadHtml, externalResources, madePayload, publishRefusal, publishedHtml } from './publish.js';
import { openDesk } from './open.js';
import { assembleDef } from './steps.js';
import { salesDraft } from './make.fixture.js';
import type { MadeData } from './types.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

/** A document that IS one file: everything inline, nothing fetched. */
function onePage(): Document {
  return new DOMParser().parseFromString('<!doctype html><html><head><style>b{}</style></head><body><div id="root"><p>the wizard</p></div><script type="module">1</script></body></html>', 'text/html');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('is this page one file?', () => {
  it('finds nothing to complain about when everything is in the document', () => {
    const doc = onePage();
    expect(externalResources(doc)).toEqual([]);
    expect(publishRefusal(doc)).toBeNull();
  });

  it('a data: URI is IN the document, not somewhere else', () => {
    const doc = new DOMParser().parseFromString('<!doctype html><html><body><script src="data:text/javascript,1"></script><link rel="stylesheet" href="data:text/css,b{}"></body></html>', 'text/html');
    expect(publishRefusal(doc)).toBeNull();
  });

  it('REFUSES in a sentence that names the files, singular and plural', () => {
    const one = new DOMParser().parseFromString('<!doctype html><html><body><script src="/assets/index-abc.js"></script></body></html>', 'text/html');
    expect(publishRefusal(one)).toContain('1 other file (/assets/index-abc.js)');
    expect(publishRefusal(one)).toContain('would open blank');

    const several = new DOMParser().parseFromString('<!doctype html><html><head><link rel="stylesheet" href="/assets/i.css"></head><body><script src="/a.js"></script><script src="/b.js"></script></body></html>', 'text/html');
    expect(publishRefusal(several)).toContain('3 other files (/a.js, /b.js, /assets/i.css)');
  });
});

describe('the file that comes out', () => {
  it('is this document with the mount emptied and the payload written in', () => {
    const html = publishedHtml(onePage(), 'QUJD', 'root');
    expect(html.startsWith('<!doctype html>\n<html>')).toBe(true);
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('the wizard'); // the wizard's own DOM is not what a reader should see first
    expect(html).toContain(`<script id="${STORY_PAYLOAD_ID}"`);
    expect(html).toContain('>QUJD</script>');
    expect(html).toContain('<script type="module">1</script>'); // the code is still there
  });

  it('REPLACES a payload the page was itself opened with, rather than carrying two', () => {
    const doc = onePage();
    doc.body.insertAdjacentHTML('beforeend', `<script id="${STORY_PAYLOAD_ID}" type="application/x">OLD</script>`);
    const html = publishedHtml(doc, 'NEW', 'root');
    expect(html).not.toContain('OLD');
    expect(html.match(new RegExp(`id="${STORY_PAYLOAD_ID}"`, 'g'))).toHaveLength(1);
  });

  it('does not need a mount it cannot find, and appends to the root when there is no body', () => {
    expect(publishedHtml(onePage(), 'X', 'nothing-called-this')).toContain('<p>the wizard</p>');
    const bodyless = document.implementation.createDocument(null, 'html', null);
    expect(publishedHtml(bodyless as unknown as Document, 'X', 'root')).toContain('>X</script>');
  });

  it('hands the file over as a download, and lets go of the object URL', () => {
    const created = vi.fn(() => 'blob:made');
    const revoked = vi.fn();
    const clicked = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: created, revokeObjectURL: revoked });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clicked);

    downloadHtml(document, '<!doctype html>', MADE_FILENAME);
    expect(created).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledWith('blob:made');
    expect(document.querySelector('a')).toBeNull(); // and takes its own anchor away again

    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('what the file carries', () => {
  it('names itself with the dashboard\'s DECLARED title, and with nothing when none was declared', () => {
    expect(declaredTitle(assembleDef(salesDraft()))).toBe('Sales, quarter by quarter');
    expect(declaredTitle(assembleDef(salesDraft({ title: '' })))).toBeUndefined();
    expect(declaredTitle(assembleDef(salesDraft({ title: '', caption: '' })))).toBeUndefined();
  });

  it('carries the trace, the beats, the pictures AND the definition — and decodes back to all four', async () => {
    const opened = openDesk(assembleDef(salesDraft()));
    if (!opened.ok) throw new Error('the fixture must open');
    const { session, def, plan } = opened.desk;
    await session.dispatch({ verb: 'select', viewId: 'regions', field: 'region', value: 'North', cause: { ...cause, intent: 'pick the north' } });
    session.bookmark('the north');
    session.saveSelection('the northern picture', { live: 'all' }, 'user');

    const payload = madePayload({ def, session, rows: plan.rows.length, builtAt: '2026-09-05' });
    expect(payload.log).toHaveLength(1);
    expect(payload.bookmarks.map((b) => b.name)).toEqual(['the north']);
    expect(payload.saved?.map((s) => s.name)).toEqual(['the northern picture']);
    expect(payload.meta.title).toBe('Sales, quarter by quarter');
    expect(payload.meta.data).toEqual({ via: 'inline', label: '6 rows and the definition this desk was made from' });
    expect(payload.data?.def).toEqual(def);

    // the whole point of the record form: it is JSON, so it survives the block
    const roundTripped: unknown = JSON.parse(JSON.stringify(payload));
    expect(roundTripped).toEqual(payload);
    opened.desk.view.dispose();
  });

  it('a desk nobody has titled publishes without a title, and the codec still reads it back', async () => {
    const opened = openDesk(assembleDef(salesDraft({ title: '' })));
    if (!opened.ok) throw new Error('the fixture must open');
    const payload = madePayload({ def: opened.desk.def, session: opened.desk.session, rows: 6, builtAt: '2026-09-05' });
    expect(payload.meta.title).toBeUndefined();

    const { encodeStoryPayload } = await import('vizfootprint-ui/story/payload');
    const encoded = await encodeStoryPayload(payload);
    if (!encoded.ok) throw new Error(encoded.sentence);
    const decoded = await decodeStoryPayload<MadeData>(encoded.text);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload.data?.def.defaultTable).toBe('data');
    opened.desk.view.dispose();
  });
});
