/**
 * THE SILENCES — what the data did not say, kept apart from what it said was
 * zero.
 *
 * The GROUPS are the host's: only the host has the rows, and only the host
 * knows what its own absence vocabulary means (`not-configured` is a different
 * fact from `withheld`, and no shell can say which is which). The panel, its
 * order, its badge and the restraint that a group with nothing in it says
 * "none this week" rather than disappearing — those are the desk's.
 */
import type { ReactNode } from 'react';
import { T } from '../tokens.js';
import type { DeskSilences } from '../types.js';

export function SilencesPanel({ silences }: { readonly silences: DeskSilences }): ReactNode {
  const colorOf = silences.colorOf ?? (() => undefined);
  return (
    <div style={{ fontSize: T.textLg, lineHeight: T.lineHeight }}>
      {silences.heading === undefined ? null : <p style={{ margin: '0 0 8px' }}>{silences.heading}</p>}
      {silences.groups.map((s) => (
        <div key={s.state} style={{ marginBottom: T.pad }}>
          <div style={{ fontWeight: 600, color: colorOf(s.state), textTransform: 'uppercase', fontSize: T.textXs, letterSpacing: '.06em' }}>
            {s.state} · {s.total} cells
          </div>
          {s.total === 0 ? (
            <div style={{ opacity: 0.7 }}>none this week</div>
          ) : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {s.areas.map(([area, of]) => (
                <li key={area}>
                  <b>{area}</b> — {of.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
