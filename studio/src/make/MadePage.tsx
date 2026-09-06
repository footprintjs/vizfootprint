/**
 * THE PAGE THIS WIZARD PUBLISHES — the desk, opened from the file it is in.
 *
 * It is the same bundle as `Make`. A published file carries a payload block
 * where the wizard's page carried none, and that is the whole difference: the
 * program looks, finds a definition, and becomes the desk rather than the
 * wizard that made it.
 *
 * What it adds to `DashboardPage` is one thing — how to turn THIS payload into
 * a session. That is the host's job everywhere else in the family because a
 * definition is usually code; here it is data, so the host's job shrinks to
 * "parse it, build it, open it", which is `openDesk`, and to drawing the cells
 * the definition implies, which is `useMadeCells`. Both are shared with the
 * wizard's own step four, so the desk a person published is the desk they were
 * looking at.
 */
import { useRef, type ReactNode } from 'react';
import { DashboardPage, type PageLens, type StoryPageSession } from 'vizfootprint-ui/story/page';
import type { StoryPayload } from 'vizfootprint-ui/story/payload';
import { Desk } from '../desk/Desk.js';
import type { DeskTokens } from '../desk/tokens.js';
import { useMadeCells, type MadePlan } from './cells.js';
import { openDesk } from './open.js';
import type { MadeData } from './types.js';

export interface MadePageProps {
  readonly tokens?: DeskTokens;
  readonly className?: string;
}

/** The published desk. Reads the definition out of the page's own payload, builds it, and draws it. */
export function MadePage({ tokens, className }: MadePageProps): ReactNode {
  // Set by `open` before the desk below is ever called — the page shows the
  // replaying state until the boot resolves, and only then mounts a lens.
  const plan = useRef<MadePlan | null>(null);

  const open = (payload: StoryPayload<MadeData>): StoryPageSession => {
    const def = payload.data?.def;
    if (def === undefined) throw new Error('this page carries no definition — it was published without one, and there is nothing to build a desk from');
    const opened = openDesk(def);
    // the library's own sentences, joined — this throw is the page's refusal
    if (!opened.ok) throw new Error(opened.refusals.join('; '));
    plan.current = opened.desk.plan;
    return opened.desk.session as unknown as StoryPageSession;
  };

  const desk = (lens: PageLens): ReactNode => <Desk view={lens.view} charts={(projection) => useMadeCells(projection, plan.current!)} tokens={tokens} />;

  return <DashboardPage<MadeData> open={open} desk={desk} className={className} />;
}
