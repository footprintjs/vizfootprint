/**
 * WHERE THE FORKS ARE.
 *
 * The rail in the time strip draws ONE path — the one you are standing on. This
 * draws them all, every lane at once, with each named path's label on its tip,
 * so "eleven bars where fifty-three stood" reads as a fork rather than as data
 * loss, and any step on any lane is one click away.
 */
import type { ReactNode } from 'react';
import { BranchMap, type SessionView, type SessionViewState } from 'vizfootprint-ui';
import { T } from '../tokens.js';

export function PathsPanel({ state, view, readOnly }: { readonly state: SessionViewState; readonly view: SessionView; readonly readOnly: boolean }): ReactNode {
  return (
    <div style={{ fontSize: T.textLg, lineHeight: T.lineHeight }}>
      <p style={{ margin: '0 0 8px' }}>
        Every line of work on this desk. The rail up top draws ONE of them — the one you are standing on; this draws them all. Click a step to go there, or use the ⎇ pill to switch paths by name.
      </p>
      <BranchMap
        commits={state.commits}
        cursor={state.cursor}
        head={state.head}
        bookmarks={state.bookmarks}
        paths={state.paths.list}
        archivedPaths={state.paths.archivedList}
        onSeek={view.seek}
        {...(readOnly ? {} : { onNewPath: view.newPathAt, onBringOver: view.bringOver })}
      />
    </div>
  );
}
