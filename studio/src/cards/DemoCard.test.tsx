// @vitest-environment jsdom
/**
 * THE CARD — and the three sentences it must print rather than imply.
 *
 * That a fact came off THIS surface's build (and not its sibling's); that a
 * surface nobody has walked says so; and that the verbs a log cannot see are a
 * silence with a reason, never a missing chip.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DemoCard } from './DemoCard.js';
import { chipsOf } from './chips.js';
import { librarySurfaces } from './cards.fixture.js';
import { deskTokenVar } from '../desk/tokens.js';
import type { DemoSurface } from './types.js';

afterEach(cleanup);

let desk: DemoSurface;
let story: DemoSurface;

beforeAll(async () => {
  ({ desk, story } = await librarySurfaces());
});

const groupOf = (ground: string, surface: DemoSurface): HTMLElement => screen.getByLabelText(`${ground} — ${surface.demo} / ${surface.surface}`);

describe('the head', () => {
  it('names the demo, the surface and the revision the card was read off', () => {
    render(<DemoCard surface={desk} />);
    const card = screen.getByLabelText('the library / desk');
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe('the library');
    expect(card.textContent).toContain('· desk');
    expect(card.textContent).toContain(desk.declares.revision);
    expect(card.textContent).toContain('the whole cockpit, built with the writers table');
    expect(within(card).getByRole('link', { name: 'open this surface' }).getAttribute('href')).toBe('#desk');
  });

  it('leaves out a blurb and a door the host did not give it', () => {
    render(<DemoCard surface={story} />);
    const card = screen.getByLabelText('the library / story page');
    expect(within(card).queryByRole('link')).toBeNull();
    expect(card.textContent).toContain(story.declares.revision);
  });
});

describe('naming the surface on every group', () => {
  it('says under each heading which build or which trace vouched for the chips', () => {
    render(<DemoCard surface={desk} />);
    expect(groupOf('declares', desk).textContent).toContain('read off the built definition of the library / desk');
    expect(groupOf('walked', desk).textContent).toContain('read off the captured trace of the library / desk');
    expect(groupOf('by hand', desk).textContent).toContain('hand-written, and derivable from nothing, for the library / desk');
  });

  it('says what each ground MEANS, so nobody reads a declaration as a walk', () => {
    render(<DemoCard surface={desk} />);
    expect(groupOf('declares', desk).textContent).toContain('this build holds it, whether or not anybody used it');
    expect(groupOf('walked', desk).textContent).toContain('a commit proves somebody did it');
    expect(groupOf('by hand', desk).textContent).toContain('only as true as its author');
  });
});

describe('the silences', () => {
  it('prints the three verbs a log cannot speak for, with the reader’s own reason', () => {
    render(<DemoCard surface={desk} />);
    const walked = groupOf('walked', desk);
    expect(walked.textContent).toContain('bookmark: cannot be seen in a log');
    expect(walked.textContent).toContain('fork: cannot be seen in a log');
    expect(walked.textContent).toContain('bookmarking lands no commit');
    // and the counted facts of the walk
    expect(walked.textContent).toContain('3 commits on 1 lane');
  });

  it('says a surface nobody has walked has no walk, rather than drawing an empty group', () => {
    render(<DemoCard surface={story} />);
    expect(groupOf('walked', story).textContent).toContain('no trace has been captured for this surface');
    expect(within(groupOf('walked', story)).queryAllByRole('button')).toEqual([]);
  });

  it('drops a group with neither chips nor sentences — a heading over nothing is furniture', () => {
    render(<DemoCard surface={story} />);
    expect(screen.queryByLabelText('by hand — the library / story page')).toBeNull();
  });
});

describe('the chips', () => {
  it('chooses a feature, and un-chooses the one already chosen', () => {
    const seen: (string | null)[] = [];
    render(<DemoCard surface={desk} onChoose={(id) => seen.push(id)} />);
    fireEvent.click(screen.getByTitle(/^heatmap —/));
    expect(seen).toEqual(['declares:chart:heatmap']);
    cleanup();
    render(<DemoCard surface={desk} chosen="declares:chart:heatmap" onChoose={(id) => seen.push(id)} />);
    const chip = screen.getByTitle(/^heatmap —/);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(seen).toEqual(['declares:chart:heatmap', null]);
  });

  it('is inert, and does not throw, on a card no gallery is listening to', () => {
    render(<DemoCard surface={desk} />);
    const chip = screen.getByTitle(/^heatmap —/);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(() => fireEvent.click(chip)).not.toThrow();
  });

  it('carries the facet beside the value — `point` the selection and `point` the link edge are two chips', () => {
    render(<DemoCard surface={desk} />);
    // three chips read "point" on this card: a selection kind the def declares, a link kind a
    // declared edge carries, and a selection somebody actually made. The facet and the group tell them apart.
    const points = screen.getAllByTitle(/^point —/);
    expect(points.map((chip) => chip.textContent)).toEqual(['selection point', 'link point', 'selection point']);
    expect(points[0]!.title).toContain('built definition');
    expect(points[2]!.title).toContain('captured trace');
  });
});

describe('the tokens', () => {
  it('writes them on its own root, so a card mounted outside a desk still has colours', () => {
    const { rerender } = render(<DemoCard surface={story} />);
    const card = (): HTMLElement => screen.getByLabelText('the library / story page');
    expect(card().style.getPropertyValue(deskTokenVar('rule'))).toBe('#d8dee4');
    rerender(<DemoCard surface={story} tokens={{ rule: '#000000' }} />);
    expect(card().style.getPropertyValue(deskTokenVar('rule'))).toBe('#000000');
  });
});

describe('generated, never typed', () => {
  it('draws exactly the chips the readers minted — no more, and in their order', () => {
    render(<DemoCard surface={desk} />);
    const drawn = screen.getAllByRole('button').map((button) => button.getAttribute('title'));
    expect(drawn).toEqual(chipsOf(desk).map((chip) => chip.title));
  });
});
