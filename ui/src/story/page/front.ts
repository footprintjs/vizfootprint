/**
 * WHAT THE PAGE SAYS IT CARRIES — one sentence, and one copy of it.
 *
 * Two pages print this line: the story page above its story, and the dashboard
 * page above its desk. Every number in it is MEASURED (the payload's bytes
 * where it was read from, the data's bytes unpacked, the acts the replay
 * landed, the records that came back) and none of it is written down — which
 * is exactly why there may only be one of it. A second spelling would be a
 * second answer to "is this file self-contained", printed by whichever page the
 * reader happened to open.
 *
 * The one word the two pages differ on is what they call a named moment: a
 * story's are its BEATS, and a dashboard that was published before anyone named
 * anything has BOOKMARKS, possibly none. So the noun is a parameter and the
 * sentence is not.
 */
import type { StoryFront } from './boot.js';

/**
 * The front matter's data line, in the words the front matter measured.
 *
 * ```ts
 * frontMatterLine(front, 'beats');
 * // 'This page carries its data — 40 rows, 8.58 MB unpacked. Its payload is 1.28 MB of this file.
 * //  32 acts replayed, 6 beats named. Built 2026-09-05.'
 * ```
 */
export function frontMatterLine(front: StoryFront, named: string): string {
  const where = front.data.via === 'inline' ? 'This page carries its data' : `This page fetches its data from ${front.data.at ?? 'where the definition says'}`;
  const label = front.data.label === undefined ? '' : ` — ${front.data.label}`;
  const size = front.size === undefined ? '' : `, ${front.size} unpacked`;
  return `${where}${label}${size}. Its payload is ${front.payload} of this file. ${String(front.landed)} acts replayed, ${String(front.bookmarks)} ${named} named. Built ${front.builtAt}.`;
}
