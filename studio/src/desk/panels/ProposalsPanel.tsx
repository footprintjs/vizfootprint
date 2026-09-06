/**
 * AGENT PROPOSALS — the charts an agent asked for, and what the session made of
 * each.
 *
 * The panel exists for the REFUSALS. An admitted proposal is a line; a refused
 * one carries its typed code and the sentence that goes with it, and both are
 * drawn, because a proposer that is only ever shown succeeding tells a reader
 * nothing about what the session will not admit.
 */
import type { ReactNode } from 'react';
import { T } from '../tokens.js';
import type { DeskProposals } from '../types.js';

export function ProposalsPanel({ proposals, readOnly, onDone }: { readonly proposals: DeskProposals; readonly readOnly: boolean; readonly onDone: () => void }): ReactNode {
  return (
    <div style={{ fontSize: T.textLg, lineHeight: T.lineHeight }}>
      {proposals.heading === undefined ? null : <p style={{ margin: '0 0 8px' }}>{proposals.heading}</p>}
      {proposals.onPropose === undefined ? null : (
        <button
          type="button"
          onClick={() => void Promise.resolve(proposals.onPropose?.()).then(onDone)}
          disabled={readOnly}
          style={{ marginBottom: T.pad }}
        >
          {proposals.proposeLabel ?? 'Propose charts'}
        </button>
      )}
      {proposals.rows.length === 0 ? null : (
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {proposals.rows.map((p, i) => (
            <li key={`${p.id}-${String(i)}`} style={{ marginBottom: T.gapSm }}>
              <span style={{ fontWeight: 600, color: p.admitted ? T.ok : T.danger }}>{p.admitted ? 'admitted' : 'refused'}</span> <code>{p.id}</code> — <i>{p.claim}</i>
              {p.admitted ? null : (
                <div style={{ opacity: 0.85 }}>
                  <code>{p.code}</code>: {p.detail}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
