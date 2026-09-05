/**
 * THE ONE QUIET LINE UNDER A STORY SECTION — what its words cited and this
 * story could not show.
 *
 * `toStory` carries every unhonourable citation on the post
 * (`StorySection.dropped`) rather than dropping it silently. A disclosure that
 * reaches the wire and no reader is the saved-selection scar again: a door the
 * library serves and no interface calls. So the sentence ships HERE, beside the
 * `dropped` rows it reads, rather than in whichever surface happened to need it
 * first — this one was written in the demo, and a second surface (the stage)
 * would have copied it, which is how one rule becomes two spellings.
 *
 * The three reasons are **different facts and are said differently**, because a
 * reader who confuses them goes looking in the wrong place: *on another path*
 * means the session really holds it and this story tells a lineage it never
 * stood on; *past the last bookmark* means it is on this very lineage, ahead of
 * every section, so naming a bookmark there would tell it; *no longer held*
 * means the session does not have it at all. A reason none of the three covers
 * gets a clause that says the citation was made, says the reason is one these
 * words cannot read, and STOPS — guessing is the failure the disclosure exists
 * to prevent.
 *
 * The line never offers to fix anything and never links what it names: the post
 * declined to vouch for that citation, and a link would hand it back.
 */

/**
 * One row of a section's `dropped`, read tolerantly. `StoryDroppedRef` (the
 * typed row) satisfies it; so does a row off a wire whose `reason` is a word
 * this version does not know — which is the point, and why `reason` is a plain
 * string here.
 */
export interface StoryDroppedLike {
  readonly reason: string;
  readonly commit?: string;
  readonly bookmark?: string;
  readonly saved?: string;
  /** The words the writer typed for the anchor, when the ref showed any. */
  readonly label?: string;
}

/** How a dropped citation is NAMED: the words the writer typed and the id together, the way the describe door refuses a dead ref. */
function citedAs(row: StoryDroppedLike): string {
  const id = row.commit ?? row.bookmark ?? row.saved ?? '';
  return row.label !== undefined && row.label.length > 0 ? `"${row.label}" (${id})` : id;
}

/** Which rows carry this reason, named. */
function citedFor(dropped: readonly StoryDroppedLike[], reason: string): string[] {
  return dropped.filter((d) => d.reason === reason).map(citedAs);
}

/**
 * ```ts
 * storyDroppedNote([{ reason: 'off-path', commit: '9', label: 'the detour' }]);
 * // 'cited and not shown — "the detour" (9) is on another path'
 * ```
 *
 * @returns the sentence, or `undefined` when the section cited nothing it could
 *   not show (which costs a reader nothing to be told).
 */
export function storyDroppedNote(dropped: readonly StoryDroppedLike[] | undefined): string | undefined {
  if (dropped === undefined || dropped.length === 0) return undefined;
  const offPath = citedFor(dropped, 'off-path');
  const untold = citedFor(dropped, 'untold');
  const gone = citedFor(dropped, 'not-held');
  const unsaid = dropped.filter((d) => d.reason !== 'off-path' && d.reason !== 'untold' && d.reason !== 'not-held').map(citedAs);
  const said: string[] = [];
  if (offPath.length > 0) said.push(`${offPath.join(', ')} ${offPath.length === 1 ? 'is' : 'are'} on another path`);
  if (untold.length > 0) said.push(`${untold.join(', ')} ${untold.length === 1 ? 'is' : 'are'} past the last bookmark`);
  if (gone.length > 0) said.push(`this session no longer holds ${gone.join(', ')}`);
  if (unsaid.length > 0) said.push(`${unsaid.join(', ')}, for a reason these words cannot read`);
  return `cited and not shown — ${said.join('; ')}`;
}
