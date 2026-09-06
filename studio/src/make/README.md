# `make` — reserved, and not built yet

`vizfootprint-studio` has two halves in its design. This is the second one, and
it is **a later packet**: the wizard that helps a person WRITE a definition —
pick the tables, name the views, wire the links, choose the encodings — and
hands back a `DashboardDef` for [`desk`](../desk/) to project.

There is nothing here but this file, on purpose.

## Why the door is not in the `exports` map yet

Because `../../../PACKAGING.md`'s law 4 bites hardest at exactly this kind of
good intention. An `exports` map replaces Node's old "any file under the package
directory" rule entirely: a subpath that is **in** the map and resolves to
nothing is not a promise of a future feature, it is
`ERR_MODULE_NOT_FOUND` at run time for anyone who reads the map and believes it —
and it can pass a type-check on the way there.

So the name is reserved here, in writing, where the next person to open this
folder will read it, and the map stays honest about what it can actually serve.
The day `make` ships, it gets its entry in `package.json`, its bundle in
`build.mjs`, and its row in the README's door table — in that one commit.
