/**
 * vizfootprint-ui/story/page — a whole dashboard, its story and its data, as ONE HTML file.
 *
 * Its own door, and not part of `vizfootprint-ui/story` or `/story/stage`, for
 * the reason those two are apart: `/story` is pure data, `/story/stage` is the
 * scroll lens over a live session, and THIS is the page that builds a session
 * out of a file and offers both lenses over it. A host that only exports a post
 * should not bundle a boot sequence, and one that only mounts the stage inside
 * a running cockpit should not bundle a payload decoder.
 *
 * It is a BUILD, not a button. Everything in a definition is data except the
 * analysis modules, which are code with a `run()` — so the def cannot be
 * serialized into the file; it is imported by a host-authored page entry and
 * bundled with the engine, the charts and storydeck. That is why the recipe in
 * ./README.md is two files the host writes and not a function this package
 * exports.
 */
export { StoryPage } from './StoryPage.js';
export type { StoryPageProps, StoryLens, StoryLensName } from './StoryPage.js';

// The boot, and the port it drives — exported because a host that wants the
// session and the story WITHOUT this page's chrome (a print view, a test, a
// second lens of its own) needs the same sequence, and a second spelling of
// "restore the pictures, replay, restore the bookmarks" is a second answer to
// what order a page opens in.
export { bootStory } from './boot.js';
export type { StoryBoot, StoryBootOptions, StoryFront, StoryPageOpen, StoryPageSession } from './boot.js';

// The payload's TYPES, because they are in this door's own signatures — a host
// holding a `StoryPageOpen` is handed a `StoryPayload` and needs to name it.
//
// The CODEC is not here. It lives on `vizfootprint-ui/story/payload`, which is
// the door a BUILD walks through, and the reason is Law 3's exactly: this entry
// pulls React and storydeck, and a build tool must be able to write what the
// page reads without loading a renderer it cannot even resolve (storydeck's ESM
// is bundler-only; plain Node refuses it). One codec, two doors onto it, split
// by which runtime is asking.
export type { StoryPayload, StoryPayloadMeta, StoryDataNote } from './payload.js';
