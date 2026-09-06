// @vitest-environment jsdom
/**
 * THE JUMP BOX — and the one thing it must never do, which is nothing.
 *
 * A commit number that is not on this lineage is a real answer ("it may be on
 * another path"), and a box that silently did not move would read as a broken
 * box rather than as a commit that is somewhere else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JumpBox } from './JumpBox.js';

afterEach(cleanup);

const ids = ['s1', 's2', 's34'];

function box(): { readonly seen: string[] } {
  const seen: string[] = [];
  render(<JumpBox commitIds={ids} onSeek={(id) => seen.push(id)} />);
  return { seen };
}

const type = (text: string): void => {
  fireEvent.change(screen.getByLabelText('commit number'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'seek' }));
};

describe('the jump box', () => {
  it('seeks by the NUMBER, whatever prefix this desk gives its ids', () => {
    const { seen } = box();
    type('34');
    expect(seen).toEqual(['s34']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('takes a # and a prefix a person typed out of habit', () => {
    const { seen } = box();
    type('#s2');
    expect(seen).toEqual(['s2']);
  });

  it('says what it wanted when the box holds no number', () => {
    const { seen } = box();
    type('  ');
    expect(seen).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('type a commit number, e.g. 34');
    type('twelve');
    expect(screen.getByRole('status').textContent).toBe('type a commit number, e.g. 34');
  });

  it('refuses a number this lineage does not hold, and says where it might be', () => {
    const { seen } = box();
    type('99');
    expect(seen).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('#99 is not on this lineage — it may be on another path');
  });

  it('clears its own note the moment it lands one', () => {
    box();
    type('99');
    expect(screen.getByRole('status')).toBeTruthy();
    type('1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('submits on Enter, and the form never reloads the page', () => {
    const { seen } = box();
    fireEvent.change(screen.getByLabelText('commit number'), { target: { value: '2' } });
    const form = screen.getByLabelText('commit number').closest('form')!;
    const submit = vi.fn();
    form.addEventListener('submit', submit);
    fireEvent.submit(form);
    expect(seen).toEqual(['s2']);
    expect(submit.mock.calls[0]![0].defaultPrevented).toBe(true);
  });
});
