# Consumer integrations

These tests exercise foreign host packages without importing them anywhere in
the library's `src` tree. Vitest runs them in the ordinary root suite. The
separate no-emit configuration preserves their type checks after the original
library type check; it does not change the library's build root or exclusions.
