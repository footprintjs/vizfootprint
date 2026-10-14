/**
 * vizfootprint-ui/story/page — a whole dashboard and its data as ONE HTML file.
 *
 * Its own door, and not part of `vizfootprint-ui/story`: `/story` is pure data,
 * and THIS is the page that builds a session out of a file and shows it. A host
 * that only exports a post should not bundle a boot sequence.
 *
 * It is a BUILD, not a button. Everything in a definition is data except the
 * analysis modules, which are code with a `run()` — so the def cannot be
 * serialized into the file; it is imported by a host-authored page entry and
 * bundled with the engine and the charts. That is why the recipe in
 * ./README.md is two files the host writes and not a function this package
 * exports.
 *
 * The STORY-shaped page (two lenses, the scroll lens over the live session) is
 * the app's: `vizfootprint-studio/story` · `StoryPage`, built on this door's
 * boot and payload. This library imports no story renderer.
 */
// The DASHBOARD-shaped entry (the story-shaped one, `vizfootprint-studio/story`,
// shares its payload, its boot and its three states): one lens, and no
// requirement that anybody has named a moment yet. An authoring wizard
// publishes through this one (`vizfootprint-studio/make`).
export { DashboardPage } from './DashboardPage.js';
export type { DashboardPageProps } from './DashboardPage.js';

// The front matter's own sentence, so a host drawing its own header prints the
// page's measured facts rather than restating them.
export { frontMatterLine } from './front.js';

// The boot, and the port it drives — exported because a host that wants the
// session and the story WITHOUT this page's chrome (a print view, a test, a
// second lens of its own) needs the same sequence, and a second spelling of
// "restore the pictures, replay, restore the bookmarks" is a second answer to
// what order a page opens in.
export { bootStory, bootSession } from './boot.js';
export type { PageLens, SessionBoot, SessionBootOptions, StoryBoot, StoryBootOptions, StoryFront, StoryPageOpen, StoryPageSession } from './boot.js';

// The payload's TYPES, because they are in this door's own signatures — a host
// holding a `StoryPageOpen` is handed a `StoryPayload` and needs to name it.
//
// The CODEC is not here. It lives on `vizfootprint-ui/story/payload`, which is
// the door a BUILD walks through, and the reason is Law 3's exactly: this entry
// pulls React, and a build tool must be able to write what the page reads
// without loading a renderer. One codec, two doors onto it, split by which
// runtime is asking.
export type { StoryPayload, StoryPayloadMeta, StoryDataNote } from './payload.js';
