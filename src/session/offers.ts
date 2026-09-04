/**
 * The OFFER: what this dashboard can be acted on with, and the one id that says
 * the agent read a CURRENT answer.
 *
 * Two functions, and the interesting thing is the LINE BETWEEN them. The list
 * does not move with the cursor — a view's voice is declared, and declaring it
 * again on every act would be N copies of one fact churning as one. The
 * position moves constantly, so it rides ONCE, beside the list, as a stamp.
 * That split is why `offers` stopped being the largest churning item in a
 * served answer (see [`../agent/README.md`](../agent/README.md), clause 4), and
 * it is the reason these two live in one small module rather than being folded
 * back into the projection that serves them: keeping them adjacent is what
 * stops the stamp being pushed back down onto each row by someone who has not
 * read that clause.
 *
 * The JUDGE stays in the session, deliberately. `offerGuard` files a typed gap
 * and needs the ledger; these two only compute. So this module is what a guard
 * compares against, never the guard itself.
 *
 * Note the duplicate, rather than hiding it: `fnv1a` here is byte-identical to
 * `src/source/hash.ts`'s. They were not merged, because the session has no
 * other reason to reach into the data-source layer and one shared 8-line hash
 * is a cheaper thing to keep in step than a new dependency between two layers
 * that otherwise never meet.
 */
import type { LinkGraph } from '../links/index.js';
import { ENCODING_KIND } from '../links/index.js';
import type { Offer } from './types.js';

/** FNV-1a over a string — a short, stable id for an offer minted at a position. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Layer 4, the OFFER (ruling 8): every (view, emission kind) of this
 * dashboard — a view's voice is declared, it does not move. The tool list
 * stays byte-stable: the offer is data in the answer, never a new tool. The
 * view's `does` sentence rides once, on `views[]`, not per offer.
 *
 * This list does NOT move with the cursor. The POSITION rides once, beside
 * it, as {@link offerStampOf} — see the note there for why.
 */
export function offersOf(views: LinkGraph['views']): Offer[] {
  const out: Offer[] = [];
  for (const view of views) {
    for (const kind of view.voice) {
      if (kind === ENCODING_KIND) continue; // a binding is followed through an edge, never acted on as an emission
      out.push({ viewId: view.viewId, kind });
    }
  }
  return out;
}

/**
 * The one id every offer in an answer is good at: the CURRENT POSITION,
 * hashed. An `asOf` minted by an earlier `whats_here` goes stale the
 * moment the position moves, and the act door says so.
 *
 * It used to be stamped onto every offer — N copies of one fact, and the
 * single largest churning item in an answer, because a select moves all N
 * while their content is identical. The check is unchanged: what an offer
 * proves is that the agent read a CURRENT answer, and the act it rides on
 * already names its own view and kind, so the node never needed restating in
 * the id. One stamp says exactly what N said.
 */
export function offerStampOf(cursor: string | null): string {
  return `o-${fnv1a(cursor ?? 'root')}`;
}
