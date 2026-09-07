/**
 * THE CHIPS — and the four things they must never do.
 *
 * They must not be TYPED (every one traces to a reader); they must not merge two
 * surfaces of one demo; they must not claim a verb a log cannot see; and they
 * must not read a correlation id as an agent's signature.
 *
 * The two surfaces come from `libraryDef(graph?)` called two ways, and the walks
 * are dispatched into real sessions — nothing in this file writes a commit or a
 * feature down by hand.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { logFeatures } from 'vizfootprint/branches';
import { byHandChipsOf, chipId, chipsOf, declaresChipsOf, groundSentenceOf, unseenOf, walkReadoutOf, walkedChipsOf } from './chips.js';
import { librarySurfaces, otherWalks } from './cards.fixture.js';
import type { DemoSurface } from './types.js';

let desk: DemoSurface;
let story: DemoSurface;

beforeAll(async () => {
  ({ desk, story } = await librarySurfaces());
});

const idsOf = (surface: DemoSurface): readonly string[] => chipsOf(surface).map((chip) => chip.id);

describe('one demo is not one dashboard', () => {
  it('gives the desk the chips its second table earns, and the story page none of them', () => {
    const deskIds = idsOf(desk);
    const storyIds = idsOf(story);
    for (const id of ['declares:chart:heatmap', 'declares:actor:agent', 'declares:relation:many-to-one', 'declares:analysis:test', 'declares:holds:prose', 'declares:holds:false-discovery control']) {
      expect(deskIds).toContain(id);
      expect(storyIds).not.toContain(id);
    }
    // and what BOTH surfaces are: the same two views, off the same function
    expect(storyIds).toContain('declares:chart:bar');
    expect(storyIds).toContain('declares:chart:line');
  });

  it('reads two revisions off two builds — the fact that makes the cards different documents', () => {
    expect(desk.declares.revision).not.toBe(story.declares.revision);
  });

  it('carries the demo and the surface on every chip, not only on the card', () => {
    for (const chip of chipsOf(desk)) {
      expect(chip.demo).toBe('the library');
      expect(chip.surface).toBe('desk');
      expect(chip.title).toContain('the library / desk');
    }
  });

  it('puts the ground in the key, so two grounds can never collide in a filter', () => {
    expect(chipId('walked', 'verb', 'select')).toBe('walked:verb:select');
    expect(idsOf(desk)).toContain('by hand:unwired:annotate');
    expect(groundSentenceOf('declares', story)).toBe('read off the built definition of the library / story page');
  });
});

describe('what a build declares', () => {
  it('reports the format of a table read through a source, and adds none for one declared as bare rows', () => {
    // `books` came through a source; `writers` is inline rows with none — one chip, not two
    expect(idsOf(desk).filter((id) => id.startsWith('declares:source:'))).toEqual(['declares:source:rows']);
  });

  it('repeats the story page’s silence about a link rule rather than printing the build’s default', () => {
    expect(story.declares.links.linkDefault).toBeNull();
    expect(idsOf(story).some((id) => id.startsWith('declares:link-default:'))).toBe(false);
    expect(idsOf(desk)).toContain('declares:link-default:crossfilter');
  });

  it('names the builtin an analysis declares, and names none for one that is code', () => {
    expect(idsOf(desk)).toContain('declares:builtin:groupBy');
    // the two code forms of a slot name no builtin — the reader leaves the field off, and the card mints nothing
    const asCode: DemoSurface = { ...desk, declares: { ...desk.declares, analyses: [{ id: 'ownWork', kind: 'test' }] } };
    const ids = declaresChipsOf(asCode).map((chip) => chip.id);
    expect(ids).toContain('declares:analysis:test');
    expect(ids.some((id) => id.startsWith('declares:builtin:'))).toBe(false);
  });

  it('says which planes the build holds, and stays silent about the ones it does not', () => {
    const deskIds = idsOf(desk);
    expect(deskIds).toContain('declares:holds:stated fold');
    expect(deskIds).toContain('declares:holds:encoding rules');
    // the story page shares the books table, so it keeps exactly the two holdings that table carries
    expect(idsOf(story).filter((id) => id.startsWith('declares:holds:'))).toEqual(['declares:holds:absence', 'declares:holds:row key']);
  });
});

describe('what somebody did', () => {
  it('mints a chip for a verb a commit proves, and none for a verb the log merely did not see', () => {
    const ids = idsOf(desk);
    expect(ids).toContain('walked:verb:select');
    expect(ids).toContain('walked:verb:reencode');
    // `bookmark`, `fork` and `navigate` land no commit — a chip would read as "used"
    expect(ids).not.toContain('walked:verb:bookmark');
    // `link` DID leave a log that could hold it, and did not — still no chip, because a chip is a claim
    expect(ids).not.toContain('walked:verb:link');
  });

  it('mints nothing at all for a surface nobody has walked', () => {
    expect(walkedChipsOf(story)).toEqual([]);
  });

  it('says a second lane was opened, once one really was', async () => {
    const { branched } = await otherWalks();
    expect(walkedChipsOf({ ...story, walked: branched }).map((chip) => chip.id)).toContain('walked:trace:branched');
    expect(idsOf(desk)).not.toContain('walked:trace:branched');
  });

  it('calls the agent only when a CAUSE names it — never on a correlation id alone', async () => {
    const { correlatedOnly, agent } = await otherWalks();
    expect(correlatedOnly.correlated).toBe(1);
    expect(correlatedOnly.agentCorrelated).toBe(0);
    expect(walkedChipsOf({ ...story, walked: correlatedOnly }).map((chip) => chip.id)).not.toContain('walked:trace:agent acted');
    expect(walkedChipsOf({ ...story, walked: agent }).map((chip) => chip.id)).toContain('walked:trace:agent acted');
  });
});

describe('the sentences a card says instead of chips', () => {
  it('hands back the three verbs a log is blind to, in the library’s own words', () => {
    const unseen = unseenOf(desk.walked!);
    expect(unseen.map((note) => note.verb)).toEqual(['navigate', 'fork', 'bookmark']);
    expect(unseen[2]!.why).toContain('bookmarking lands no commit');
  });

  it('counts the walk, and leaves the family line off a log with nothing in it', () => {
    expect(walkReadoutOf(desk.walked!)).toEqual(['3 commits on 1 lane', '0 bookmarks, 0 saved selections', '2 interaction · 1 design']);
    expect(walkReadoutOf(logFeatures([]))).toEqual(['0 commits on 0 lanes', '0 bookmarks, 0 saved selections']);
  });

  it('says the correlation twice — the ids, and then who the causes name', async () => {
    const { correlatedOnly, agent, branched } = await otherWalks();
    expect(walkReadoutOf(correlatedOnly).at(-1)).toBe("a correlation id sits on 1 commit, and not one of them names the agent — an id is a caller's join key, not a signature");
    expect(walkReadoutOf(agent).at(-1)).toBe("a correlation id sits on 1 commit; the agent's own cause is on 1 of them");
    // a walk with no ids at all says nothing about correlation rather than saying zero
    expect(walkReadoutOf(branched).some((line) => line.includes('correlation'))).toBe(false);
    expect(walkReadoutOf(branched)[1]).toBe('1 bookmark, 0 saved selections');
  });
});

describe('what only a person knows', () => {
  it('separates a gesture from a verb this build wires nothing to', () => {
    const byHand = byHandChipsOf(desk);
    const gesture = byHand.find((chip) => chip.label === 'select')!;
    const unwired = byHand.find((chip) => chip.label === 'annotate')!;
    expect(gesture.facet).toBe('gesture');
    expect(gesture.title).toContain('produced by: click a bar');
    expect(unwired.facet).toBe('unwired');
    expect(unwired.title).toContain('wires no gesture to');
    expect(unwired.title).toContain('hand-written, and derivable from nothing');
  });

  it('mints nothing for a surface whose host wrote no notes', () => {
    expect(byHandChipsOf(story)).toEqual([]);
  });
});
