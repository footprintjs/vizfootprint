/**
 * TEST HELPER — the bar over raw log inputs.
 *
 * `<TimeTravelBar>` renders a model and nothing else. The component tests were
 * written against commits, a cursor and a head, and they pin the rendered
 * result of the whole chain. This helper derives the model the way the door
 * does (`timeTravelModel`), so each of those tests still exercises data logic
 * and rendering together.
 */
import { TimeTravelBar, type TimeTravelBarProps } from './TimeTravelBar.js';
import { timeTravelModel } from './model.js';
import type { BookmarkView, BranchView, CommitView } from '../adapter/types.js';

export interface RawBarProps extends Omit<TimeTravelBarProps, 'model'> {
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly bookmarks?: readonly BookmarkView[];
  readonly branches?: readonly BranchView[];
  readonly pathName?: string;
}

export function RawBar({ commits, cursor, head, bookmarks, branches, pathName, ...rest }: RawBarProps): JSX.Element {
  const model = timeTravelModel({
    commits,
    cursor,
    head,
    ...(bookmarks !== undefined ? { bookmarks } : {}),
    ...(branches !== undefined ? { pathCount: branches.length } : {}),
    ...(pathName !== undefined ? { pathName } : {}),
  });
  return <TimeTravelBar model={model} {...rest} />;
}
