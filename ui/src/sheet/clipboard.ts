/**
 * The clipboard is the USER's, not the page's — one door, two callers.
 *
 * Both copies in this folder are READS (`./README.md`, "Copy and export are
 * reads"): the export form puts a whole window on the clipboard as TSV, and the
 * grid puts one focused cell there. Neither may assume the page HAS a clipboard
 * — a server render has no `navigator`, an insecure context has no `clipboard`,
 * and a browser may refuse the write outright. All three are one sentence to the
 * person, so all three arrive here as a throw and leave as `clipboardRefusal`.
 *
 * WHY its own module rather than a helper inside `./ExportRows.tsx`: the grid
 * needs it too, and a `<Sheet>` that imported the export FORM to reach the
 * clipboard would drag the whole export walk into every bundle that renders a
 * grid. Two callers, one owner, no component in between.
 */

/** What a page with no clipboard says. Not a failure of the copy — a fact about the page. */
export const NO_CLIPBOARD = 'this page has no clipboard to write to';

/** Put the text on the clipboard, or throw with why not. */
export async function writeClipboard(text: string): Promise<void> {
  const board = globalThis.navigator?.clipboard;
  if (board === undefined) throw new Error(NO_CLIPBOARD);
  await board.writeText(text);
}

/**
 * The browser said no, in its OWN words.
 *
 * `reason` is `unknown` because a browser may reject with anything at all, and
 * every caller would otherwise repeat the same `instanceof Error` dance to find
 * the words — one refusal sentence, said one way, from one place.
 */
export function clipboardRefusal(reason: unknown): string {
  return `the browser refused the clipboard: ${reason instanceof Error ? reason.message : String(reason)}`;
}
