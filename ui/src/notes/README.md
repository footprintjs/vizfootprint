# notes — the Text tool

A note is words on the dashboard: the prose plane's `note:<id>` subject, with an author, refs and a basis, rendered as a cockpit cell.

```tsx
import { NoteCell, linkablesOf, mentionWorldOf } from 'vizfootprint-ui';

const world = mentionWorldOf(state);
const linkables = linkablesOf(state);
{state.notes?.map((n) => <NoteCell key={n.id} note={n} world={world} linkables={linkables} by="you" onDescribe={(id, slot, record) => view.describe(`note:${id}`, slot, record)} /* answers { ok } or { ok: false, sentence } */ onSeek={(c) => view.seek(c)} />)}
```

## The laws

- **A note is a describe.** A fresh `note:<id>` is created by its first describe; every save is one commit with a cause; null on every slot takes it off the dashboard while its commits stay, so seeking back shows it again. A note carries a `title` and a `caption` only — the session refuses any other slot on a note, so nothing can sit on one the cell cannot show or remove.
- **A new note is opened, not committed.** `fresh` renders the cell writing, with nothing in the log; the first Save is the first commit, Cancel calls `onDiscard` and the host drops the cell. The log never holds words nobody wrote.
- **The session answers every save.** `onDescribe` returns `{ ok: true }` or `{ ok: false, sentence }` (the adapter's `view.describe` answers exactly that); the editor closes only on `ok`, and a refusal stays on screen with the words intact — nothing typed is lost to a silent no.
- **Links are mentions, resolved against what the session holds.** `#s12` names a commit, `@[coastal]` a saved selection, `@[Formal wear]` a checkpoint (`@name` without brackets when the name has no spaces). A marker inside a word (`issue#12`, `me@example.com`) is plain text. The picker inserts a mention for anything in `linkablesOf(state)` — choose, then press Insert; the mention lands at the caret you last had in the words, else at the end (clicking Insert takes the focus out of the textarea, so the place is remembered as you make it, not asked for afterwards). The picker's reach into the log is the newest `RECENT_COMMITS` (12) commits — an older one is linked by typing its `#id`. What you pick is the MENTION, not a row number: the list is rebuilt on every poll, so a pick that is no longer offered when you press Insert is refused ("that link is no longer offered — pick again") rather than inserting whatever now sits in its place. `mentionWorldOf(state)` is the grammar's world — name → the ID a ref carries, so a record can be renamed without touching a note. On save the mentions become refs (the id as the target, the name as the label), the same shape the analyst's replies carry, and the words are rendered with anchors that seek.
- **Every mention the picker offers resolves.** A name the brackets cannot carry (a `]`, a line break, a space at either end) is offered by its commit id; two saves under one name resolve to the newest and the older is offered by its id; a beat with neither a safe label nor a commit is not offered, and neither is one from a wire that predates tag ids (there is no id to link by name, so its commit is offered instead).
- **Nothing links silently.** A mention that resolves to nothing is refused with its sentence and the note is not saved until it is fixed or removed; the library's validator also refuses a ref whose commit the log does not hold.
- **The analyst's words can become a note.** "Add to dashboard" on a reply is a describe with the reply's text and refs, the analyst and its model as author, and a basis of the cursor and the live selections — so the note goes stale honestly when the selection moves, exactly like a caption. No claim level is invented for it: a level is the writer's, never the button's.
- **Judged like the dashboard's words.** Nothing of a note is derived and its basis never states encodings; a note binds nothing.

## Not here, on purpose

No rich text, no per-cell formulas, no right-click linking yet (the picker and the mention grammar are the two doors).
