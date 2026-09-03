// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProseText, pieces, marks, runs } from './ProseText.js';

afterEach(cleanup);

describe('pieces', () => {
  it('cuts the text at the refs in order, skipping overlaps and out-of-range spans', () => {
    const text = 'Oklahoma leads; Texas follows.';
    expect(pieces(text, [{ span: [16, 29], beat: 't1' }, { span: [0, 8], commit: 'c1' }, { span: [4, 10], commit: 'x' }, { span: [20, 99], commit: 'y' }]).map((p) => [p.text, p.ref?.commit ?? p.ref?.beat ?? null, p.from, p.to])).toEqual([
      ['Oklahoma', 'c1', 0, 8],
      [' leads; ', null, 8, 16],
      ['Texas follows', 't1', 16, 29],
      ['.', null, 29, 30],
    ]);
    expect(pieces('plain')).toEqual([{ text: 'plain', index: -1, from: 0, to: 5 }]);
  });
});

describe('ProseText', () => {
  it('renders anchors that describe and go to their target; a beat goes to onBeat by its tag ID; a label overrides the words', () => {
    const onSeek = vi.fn();
    const onBeat = vi.fn();
    render(
      <ProseText
        text="Oklahoma leads; Texas follows."
        refs={[{ span: [0, 8], commit: 'c1' }, { span: [16, 21], beat: 't1', label: 'week 1' }, { span: [22, 29], commit: 'c2', label: 'see the run' }]}
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
    expect(onBeat).toHaveBeenCalledWith('t1'); // the ID travels, never the name
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

describe('runs and marks', () => {
  it('maps every run to the offsets it occupies in the ORIGINAL text, markers included', () => {
    expect(runs('**South Atlantic** leads')).toEqual([
      { kind: 'marker', from: 0, to: 2 },
      { kind: 'bold', from: 2, to: 16 },
      { kind: 'marker', from: 16, to: 18 },
      { kind: 'plain', from: 18, to: 24 },
    ]);
    expect(runs('')).toEqual([]);
  });
  it('cuts out `code` and **bold** and leaves every other character exactly as written', () => {
    expect(marks('**South Atlantic** leads with a mean of `19.09` cases/week.')).toEqual([
      { text: 'South Atlantic', kind: 'bold' },
      { text: ' leads with a mean of ', kind: 'plain' },
      { text: '19.09', kind: 'code' },
      { text: ' cases/week.', kind: 'plain' },
    ]);
    expect(marks('plain words')).toEqual([{ text: 'plain words', kind: 'plain' }]);
    expect(marks('')).toEqual([]);
  });
  it('an unmatched marker is a character, arithmetic is not bold, and a mark may close the run', () => {
    expect(marks('2 ** 3 and 4 ** 5')).toEqual([{ text: '2 ** 3 and 4 ** 5', kind: 'plain' }]); // ** must hug its words
    expect(marks('a lone ** stays')).toEqual([{ text: 'a lone ** stays', kind: 'plain' }]);
    expect(marks('the value is **19**')).toEqual([
      { text: 'the value is ', kind: 'plain' },
      { text: '19', kind: 'bold' },
    ]);
    expect(marks('**a** and `b`')).toEqual([
      { text: 'a', kind: 'bold' },
      { text: ' and ', kind: 'plain' },
      { text: 'b', kind: 'code' },
    ]);
    // two bolds on one line stay two, however short: the closing marker is the FIRST one that fits
    expect(marks('**5** cases and **9** more')).toEqual([
      { text: '5', kind: 'bold' },
      { text: ' cases and ', kind: 'plain' },
      { text: '9', kind: 'bold' },
      { text: ' more', kind: 'plain' },
    ]);
    expect(marks('**a** leads **b** cases.')).toEqual([
      { text: 'a', kind: 'bold' },
      { text: ' leads ', kind: 'plain' },
      { text: 'b', kind: 'bold' },
      { text: ' cases.', kind: 'plain' },
    ]);
    expect(marks('**ab** and **cd**')).toEqual([
      { text: 'ab', kind: 'bold' },
      { text: ' and ', kind: 'plain' },
      { text: 'cd', kind: 'bold' },
    ]);
    // ***triple*** is not a form we know — the odd asterisks stay on the screen, as the doc says
    expect(marks('***triple***')).toEqual([
      { text: '*', kind: 'plain' },
      { text: 'triple', kind: 'bold' },
      { text: '*', kind: 'plain' },
    ]);
  });
});

describe('ProseText with markdown on', () => {
  it('a link INSIDE the asterisks still reads as bold, and the asterisks still leave the screen', () => {
    // the model wrote **South Atlantic** and cited "South Atlantic" — the span sits inside the markers
    render(<ProseText markdown text="**South Atlantic** leads." refs={[{ span: [2, 16], commit: 's67' }]} />);
    const root = document.querySelector('.vzf-prosetext') as HTMLElement;
    expect(root.textContent).toBe('South Atlantic1 leads.'); // no asterisks anywhere
    expect(root.querySelector('.vzf-prosetext-ref strong')?.textContent).toBe('South Atlantic');
  });
  it('a span that INCLUDES the markers reads the same way', () => {
    render(<ProseText markdown text="**South Atlantic** leads." refs={[{ span: [0, 18], commit: 's67' }]} />);
    const root = document.querySelector('.vzf-prosetext') as HTMLElement;
    expect(root.textContent).toBe('South Atlantic1 leads.');
    expect(root.querySelector('.vzf-prosetext-ref strong')?.textContent).toBe('South Atlantic');
  });
  it('a link inside `code`, and the marks outside a ref', () => {
    render(<ProseText markdown text="I ran `casesByArea` over the **present cells**." refs={[{ span: [7, 18], commit: 's70' }]} />);
    const root = document.querySelector('.vzf-prosetext') as HTMLElement;
    expect(root.textContent).toBe('I ran casesByArea1 over the present cells.');
    expect(root.querySelector('.vzf-prosetext-ref code')?.textContent).toBe('casesByArea');
    expect(root.querySelector('strong')?.textContent).toBe('present cells');
  });
  it('off by default: the markers stay on the screen exactly as the author wrote them', () => {
    render(<ProseText text="**South Atlantic** leads." />);
    expect(document.querySelector('.vzf-prosetext')?.textContent).toBe('**South Atlantic** leads.');
    expect(document.querySelector('strong')).toBeNull();
  });
});
