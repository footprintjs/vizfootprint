/**
 * MENTIONS — how a person's typed words link to what the session holds.
 *
 * The analyst's replies carry refs (a span of text tied to a commit or a
 * beat). A person typing a note gets the same power through three mentions:
 *   `#s12`             a commit by its id
 *   `@Formal wear`     a beat by its label, or a saved selection by its name
 *   `@[Formal wear]`   the same, bracketed, when the name carries spaces or ends mid-sentence
 * A mention that resolves to nothing is REPORTED with its span — never
 * silently dropped and never invented — so the caller can refuse the words
 * or ask again. The words themselves stay as typed; the refs ride beside them.
 */
import type { ProseRef } from './types.js';

/**
 * What a mention may point at: the commits the log holds (id → a label for
 * display), the tags by name, and the saved selections by name (saved LOGIC —
 * a ref to one applies it, it does not seek). A person types a NAME; the ref
 * carries the record's ID, which is why the two maps read name → id: renaming
 * a tag or a picture leaves every note pointing at the same thing. A name that
 * is both a saved selection and a tag resolves to the SAVED selection: the
 * logic wins over the moment.
 */
export interface MentionWorld {
  readonly commits: ReadonlyMap<string, string>;
  /** Tag name → the tag's id. */
  readonly beats: ReadonlyMap<string, string>;
  /** Saved-selection name → the picture's id. */
  readonly saved: ReadonlyMap<string, string>;
}

export interface UnresolvedMention {
  /** The mention as typed, marker included. */
  readonly mention: string;
  readonly span: readonly [number, number];
  /** Why it resolved to nothing, in a sentence. */
  readonly sentence: string;
}

export interface Mentions {
  readonly refs: readonly ProseRef[];
  readonly unresolved: readonly UnresolvedMention[];
}

/**
 * `#id`, `@[name]`, `@name` — in that order, left to right, never overlapping.
 * A marker inside a word is plain text (`issue#12`, `me@example.com`): a
 * mention starts at a word boundary, so ordinary prose never turns into a
 * link the writer did not mean. The BARE form also stops at a quote or an
 * apostrophe, straight or curly, so `"@coastal"` and `@coastal's` link
 * `coastal` instead of refusing the whole save on a name nobody typed; a name
 * that really carries one is written bracketed, `@[it's mine]`.
 */
const MENTION = /(?<![\p{L}\p{N}_])(?:#([A-Za-z0-9_-]+)|@\[([^\]\n]+)\]|@([^\s@#\[\],.;:!?()'"\u2019\u201c\u201d]+))/gu;

export function mentionsToRefs(text: string, world: MentionWorld): Mentions {
  const refs: ProseRef[] = [];
  const unresolved: UnresolvedMention[] = [];
  for (const m of text.matchAll(MENTION)) {
    const start = m.index;
    const span: [number, number] = [start, start + m[0].length];
    if (m[1] !== undefined) {
      const id = m[1];
      const label = world.commits.get(id);
      if (label !== undefined) refs.push({ span, commit: id, label });
      else unresolved.push({ mention: m[0], span, sentence: `#${id} names no commit the log holds` });
      continue;
    }
    const name = (m[2] ?? m[3])!.trim();
    // the ref carries the id; the words the person typed ride along as the label, so the anchor still reads as they wrote it
    const savedId = world.saved.get(name);
    const beatId = world.beats.get(name);
    if (savedId !== undefined) refs.push({ span, saved: savedId, label: name });
    else if (beatId !== undefined) refs.push({ span, beat: beatId, label: name });
    else unresolved.push({ mention: m[0], span, sentence: `@${name} is neither a saved selection nor a checkpoint` });
  }
  return { refs, unresolved };
}
