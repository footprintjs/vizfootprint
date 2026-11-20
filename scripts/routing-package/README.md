# Packed routing boundary

`check.mjs` inspects the actual archive extracted by the existing profile package
check. It rejects a host runtime/peer declaration, any host name in built files
(including declarations and source maps), and host imports in library source.
Development dependencies and the consumer's README adapter remain allowed.
The existing locked TypeScript parser identifies source imports (including
side-effect, type-only, dynamic and require forms), without mistaking comments
or data strings for imports.

The adjacent data-only tests inject each forbidden declaration/file/import.
The actual package check also dirties one extracted built file, proves refusal,
then restores it before continuing. No sibling dist tree is substituted.

`../check-routing-mutant.mjs`, in the compatibility report, removes numeric
validation, policy input custody and the built-file check one at a time. Each
original assertion must fail normally; the source bytes are restored in a
finally block. Each fixed control runs once, never as a retry.
