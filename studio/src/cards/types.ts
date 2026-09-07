/**
 * WHAT A DEMO COVERS — the card's data, and the ONE thing on it nobody can
 * derive.
 *
 * THE LAW IT FOLLOWS: **a chip is generated, never typed.** Every feature a
 * card advertises is read off one of the library's two readers —
 * `defFeatures(dashboard)` for what a build CAN do, `logFeatures(records)` for
 * what somebody DID — so a demo that gains a view gains a chip, and a demo that
 * loses one loses it, without anybody editing a list.
 *
 * THE SECOND LAW: **one demo is not one dashboard.** The CDC demo's desk builds
 * its definition WITH the co-occurrence graph (a network view, two layers, eight
 * analyses); its story page builds the same demo WITHOUT it, and the captured
 * trace never touches the network at all. A card that merged the two would
 * advertise a capability the page a reader opens does not have — so a card is
 * per SURFACE, and every chip carries the demo and the surface it came from
 * (see {@link FeatureChip}), which is what lets a chip survive being lifted out
 * of its card and into a filter's answer.
 *
 * THE THIRD LAW: **a chip is a claim.** What a log cannot see is a SENTENCE, not
 * a chip. Three of the ten verbs land no commit, and `logFeatures` answers
 * `'unseen'` for those — the card prints that sentence in the open rather than
 * minting a chip that would read as "not used".
 *
 * WHAT STAYS HAND-WRITTEN, and is labelled as such on the card: {@link
 * GestureNote} — which gesture produces which verb in THIS build, and which
 * verbs the build leaves unwired. Neither is anywhere in a definition or a log:
 * a def declares that `annotate` exists, a log shows it never landed, and only a
 * person knows the difference between "nobody used it" and "this cockpit has no
 * gesture for it". The CDC demo already writes that table honestly
 * (`web/src/GrammarPanel.tsx`); this type is that table, typed.
 *
 * FIRST CUSTOMERS: a gallery of demos, and the filter that narrows it to the
 * demos carrying one chosen feature.
 */
import type { DashboardFeatures } from 'vizfootprint/def';
import type { LogFeatures, LogVerb } from 'vizfootprint/branches';

// ── What a host hands in ──────────────────────────────────────────────────────

/**
 * How a person produces one verb on one surface — the hand-written half.
 *
 * `gesture: null` is the honest entry a derived list can never hold: the build
 * DECLARES this verb and wires no gesture to it. The CDC desk's `annotate` is
 * exactly that, and saying so is worth more than leaving the row out.
 */
export interface GestureNote {
  readonly verb: LogVerb;
  /** The gesture, in the words a reader would use — or `null` when this build leaves the verb unwired. */
  readonly gesture: string | null;
}

/**
 * ONE SURFACE of one demo: what it declares, what somebody did on it, and the
 * notes no reader can produce.
 *
 * `walked` is optional because a surface can exist with no captured trace, and
 * "nobody has walked this one yet" is a different card from "somebody walked it
 * and did nothing" — the card draws the second and omits the group for the
 * first.
 */
export interface DemoSurface {
  /** The demo this surface belongs to — two surfaces of one demo share it. */
  readonly demo: string;
  /** Which surface of that demo: `desk`, `story page`, `wizard output` … */
  readonly surface: string;
  /** One line of prose about this surface, if the host has one. */
  readonly blurb?: string;
  /** Where a reader opens it. */
  readonly href?: string;
  /** Reader A, over THIS surface's built dashboard. */
  readonly declares: DashboardFeatures;
  /** Reader B, over THIS surface's captured trace; absent when none was captured. */
  readonly walked?: LogFeatures;
  /** The hand-written notes, labelled as such on the card. */
  readonly byHand?: readonly GestureNote[];
}

// ── What comes out ────────────────────────────────────────────────────────────

/**
 * Which reader vouched for a chip — and therefore how much it is allowed to
 * claim.
 *
 * `declares` = the build holds it. `walked` = a commit proves somebody did it.
 * `by hand` = a person wrote it down and no reader can check it. Three grounds,
 * never mixed, because "this demo can do X" and "somebody did X" are different
 * sentences and a card that blurred them would be the drift these readers exist
 * to prevent.
 */
export type ChipGround = 'declares' | 'walked' | 'by hand';

/**
 * One feature a card advertises, and the filter key it answers to.
 *
 * `id` is `<ground>:<facet>:<value>` — the ground is IN the key on purpose, so
 * "declares a network view" and "somebody walked one" can never collide in a
 * filter, and a chip lifted out of its card still says who vouched for it.
 */
export interface FeatureChip {
  readonly id: string;
  readonly ground: ChipGround;
  /** The kind of thing: `chart`, `selection`, `verb`, `analysis`, `gesture` … */
  readonly facet: string;
  /** What a reader sees on the chip — the value, in the library's own words. */
  readonly label: string;
  /** The sentence behind it, naming the demo and the surface it was read off. */
  readonly title: string;
  /** WHICH SURFACE this fact came from — carried on the chip, not only on the card (law 2). */
  readonly demo: string;
  readonly surface: string;
}

/** One choice in a filter: a feature, and how many surfaces carry it. */
export interface FeatureChoice {
  readonly id: string;
  readonly ground: ChipGround;
  readonly facet: string;
  readonly label: string;
  /** How many surfaces in the list carry it — a filter that offered a choice narrowing to nothing would be furniture. */
  readonly surfaces: number;
}
