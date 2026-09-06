/**
 * WHAT THE BROWSER SAYS ABOUT ITSELF — the desk's default status readout.
 *
 * A screenshot of a dashboard is a claim about a layout, and a layout question
 * that cannot be answered from the picture ("at what width? at what zoom?") is
 * a question somebody guesses at. This makes the picture answer it.
 *
 * A host that has something better to say puts it in the desk's `status` slot.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { T } from './tokens.js';

export function WindowReadout(): ReactNode {
  const read = (): string => `window ${window.innerWidth}×${window.innerHeight} · pixel ratio ${window.devicePixelRatio}`;
  const [text, setText] = useState(read);
  useEffect(() => {
    const onResize = (): void => setText(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return <span style={{ fontSize: T.textXs, opacity: 0.55, fontFamily: T.mono }}>{text}</span>;
}
