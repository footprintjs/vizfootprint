// @vitest-environment jsdom
/**
 * THE GALLERY — two surfaces of one demo, side by side, and one question that
 * narrows them.
 *
 * The assertions are all about the same law: the narrowing happens to SURFACES.
 * A reader who asks for a heatmap gets the one card that draws one, and the
 * count line says so in surfaces before it says anything about demos.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DemoGallery } from './DemoGallery.js';
import { choicesOf } from './filter.js';
import { librarySurfaces } from './cards.fixture.js';
import type { DemoSurface } from './types.js';

afterEach(cleanup);

let both: readonly DemoSurface[];

beforeAll(async () => {
  const { desk, story } = await librarySurfaces();
  both = [desk, story];
});

const cards = (): readonly string[] => screen.getAllByRole('article').map((card) => card.getAttribute('aria-label')!);
const picker = (): HTMLSelectElement => screen.getByLabelText('feature') as HTMLSelectElement;
const pick = (id: string): void => {
  fireEvent.change(picker(), { target: { value: id } });
};

describe('the two surfaces, side by side', () => {
  it('draws one card per surface, and says so in surfaces before demos', () => {
    render(<DemoGallery surfaces={both} heading="What the demos cover" />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('What the demos cover');
    expect(cards()).toEqual(['the library / desk', 'the library / story page']);
    expect(screen.getByRole('status').textContent).toBe('2 of 2 surfaces · 1 of 1 demos');
  });

  it('goes without a heading when the page has already given it one', () => {
    render(<DemoGallery surfaces={both} />);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});

describe('narrowing', () => {
  it('narrows to the surface that carries the feature, and leaves its sibling out', () => {
    render(<DemoGallery surfaces={both} />);
    pick('declares:chart:heatmap');
    expect(cards()).toEqual(['the library / desk']);
    expect(screen.getByRole('status').textContent).toBe('1 of 2 surfaces · 1 of 1 demos');
  });

  it('marks the chip that matched, so a reader can see WHY this card is here', () => {
    render(<DemoGallery surfaces={both} />);
    pick('declares:chart:heatmap');
    expect(screen.getByTitle(/^heatmap —/).getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows by clicking a chip on a card, exactly as the picker does', () => {
    render(<DemoGallery surfaces={both} />);
    fireEvent.click(screen.getByTitle(/^heatmap —/));
    expect(cards()).toEqual(['the library / desk']);
    expect(picker().value).toBe('declares:chart:heatmap');
    // and clicking the chosen chip again lets everything back in
    fireEvent.click(screen.getByTitle(/^heatmap —/));
    expect(cards()).toHaveLength(2);
  });

  it('offers a way back only while it is narrowed', () => {
    render(<DemoGallery surfaces={both} />);
    expect(screen.queryByRole('button', { name: 'show all' })).toBeNull();
    pick('declares:chart:heatmap');
    fireEvent.click(screen.getByRole('button', { name: 'show all' }));
    expect(cards()).toHaveLength(2);
    expect(picker().value).toBe('');
  });

  it('takes the empty option as "any feature"', () => {
    render(<DemoGallery surfaces={both} initialChoice="declares:chart:heatmap" />);
    expect(cards()).toEqual(['the library / desk']);
    pick('');
    expect(cards()).toHaveLength(2);
  });

  it('tells a host every time the narrowing moves, for a URL to keep', () => {
    const seen: (string | null)[] = [];
    render(<DemoGallery surfaces={both} onChoose={(id) => seen.push(id)} />);
    pick('declares:chart:heatmap');
    fireEvent.click(screen.getByRole('button', { name: 'show all' }));
    expect(seen).toEqual(['declares:chart:heatmap', null]);
  });
});

describe('the picker', () => {
  it('offers the cards’ own chips and nothing else, counted', () => {
    render(<DemoGallery surfaces={both} />);
    const options = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(options[0]).toBe('');
    expect(options.slice(1)).toEqual(choicesOf(both).map((choice) => choice.id));
    expect(screen.getByRole('option', { name: 'declares · chart: bar (2)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'declares · chart: heatmap (1)' })).toBeTruthy();
  });
});

describe('the refusal', () => {
  it('says what nothing carries rather than drawing an empty grid', () => {
    render(<DemoGallery surfaces={both} initialChoice="declares:chart:sunburst" />);
    expect(screen.queryAllByRole('article')).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('no surface here carries "declares:chart:sunburst"');
    expect(screen.getByRole('status').textContent).toBe('0 of 2 surfaces · 0 of 1 demos');
  });
});
