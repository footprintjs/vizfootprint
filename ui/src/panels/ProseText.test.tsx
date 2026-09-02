// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProseText, pieces } from './ProseText.js';

afterEach(cleanup);

describe('pieces', () => {
  it('cuts the text at the refs in order, skipping overlaps and out-of-range spans', () => {
    const text = 'Oklahoma leads; Texas follows.';
    expect(pieces(text, [{ span: [16, 29], beat: 'b' }, { span: [0, 8], commit: 'c1' }, { span: [4, 10], commit: 'x' }, { span: [20, 99], commit: 'y' }]).map((p) => [p.text, p.ref?.commit ?? p.ref?.beat ?? null])).toEqual([
      ['Oklahoma', 'c1'],
      [' leads; ', null],
      ['Texas follows', 'b'],
      ['.', null],
    ]);
    expect(pieces('plain')).toEqual([{ text: 'plain', index: -1 }]);
  });
});

describe('ProseText', () => {
  it('renders anchors that describe and go to their target; a beat goes to onBeat; a label overrides the words', () => {
    const onSeek = vi.fn();
    const onBeat = vi.fn();
    render(
      <ProseText
        text="Oklahoma leads; Texas follows."
        refs={[{ span: [0, 8], commit: 'c1' }, { span: [16, 21], beat: 'week 1' }, { span: [22, 29], commit: 'c2', label: 'see the run' }]}
        describeCommit={(id) => (id === 'c1' ? 'select kind = state' : undefined)}
        onSeek={onSeek}
        onBeat={onBeat}
      />,
    );
    const a1 = screen.getByRole('button', { name: 'go to commit #c1' });
    expect(a1.getAttribute('title')).toBe('commit #c1: select kind = state');
    fireEvent.click(a1);
    expect(onSeek).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: 'go to beat "week 1"' }));
    expect(onBeat).toHaveBeenCalledWith('week 1');
    expect(screen.getByRole('button', { name: 'go to commit #c2' }).getAttribute('title')).toBe('see the run');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['1', '2', '3']);
  });
  it('a ref with no target still renders, as an anchor that goes nowhere', () => {
    const onSeek = vi.fn();
    render(<ProseText text="ab" refs={[{ span: [0, 1] }]} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'go to beat ""' }));
    expect(onSeek).not.toHaveBeenCalled();
  });
  it('without handlers the anchors are inert', () => {
    render(<ProseText text="ab" refs={[{ span: [0, 1], commit: 'c' }, { span: [1, 2], beat: 'b' }]} className="mine" />);
    fireEvent.click(screen.getByRole('button', { name: 'go to commit #c' }));
    fireEvent.click(screen.getByRole('button', { name: 'go to beat "b"' }));
    expect(document.querySelector('.vzf-prosetext.mine')).toBeTruthy();
  });
});
