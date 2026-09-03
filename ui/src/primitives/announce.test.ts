// @vitest-environment jsdom
/**
 * The polite live region — the ONE thing that tells a screen-reader user about
 * a change nothing focused reports (a re-encode). Silent for sighted users,
 * body-parked so it outlives the surface that wrote it, and repeatable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { announce } from './announce.js';

const region = (): HTMLElement | null => document.querySelector('.vzf-live-region');

beforeEach(() => {
  for (const el of Array.from(document.querySelectorAll('.vzf-live-region'))) el.remove();
});

describe('announce', () => {
  it('creates ONE polite, atomic status region on the body and writes the message into it', () => {
    announce('x now encodes price');
    const el = region()!;
    expect(el.parentElement).toBe(document.body);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-atomic')).toBe('true');
    expect(el.textContent).toBe('x now encodes price');

    // a second, different message reuses the SAME region (assistive tech needs
    // the node to already exist when its text changes)
    announce('y now encodes cases');
    expect(document.querySelectorAll('.vzf-live-region')).toHaveLength(1);
    expect(region()!.textContent).toBe('y now encodes cases');
  });

  it('re-says an identical message (a changed text node, the same sentence)', () => {
    announce('x now encodes price');
    announce('x now encodes price');
    // the text CHANGED (trailing space) — otherwise a repeat would be silent
    expect(region()!.textContent).toBe('x now encodes price\u00a0');
    announce('x now encodes price');
    expect(region()!.textContent).toBe('x now encodes price');
  });

  it('rebuilds the region if a host tore it out of the document', () => {
    announce('first');
    region()!.remove();
    announce('second');
    expect(region()!.textContent).toBe('second');
    expect(document.querySelectorAll('.vzf-live-region')).toHaveLength(1);
  });
});
