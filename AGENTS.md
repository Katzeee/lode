# Development Guide

Methodology only. This doc describes _how_ to write and change code here — not what the code
currently is. Package and layer boundaries are enforced by ESLint (`eslint.config.mjs`); that
config is the live source of truth, so they are intentionally not restated in prose (a written copy
would drift the moment the code moves). When you need the current boundaries, read the eslint rules
and the code.

## Code Style

Design for the long-term health of the architecture: a codebase that stays clean, coherent, and
economical to extend as it grows large. Get there through sound software design — fitting
abstractions, appropriate design patterns, clear module boundaries, high cohesion, and low
accidental coupling — applied with deliberate engineering judgment. Optimize for the cost of future
change, not the cost of writing today. The bar for any structural decision is whether it leaves the
architecture genuinely better — more comprehensible, more extensible, cheaper to maintain — not
whether it is more or less abstract.

Comments should explain why something is non-obvious, not restate what the code does.

Avoid `any`; use `unknown` and narrow it. Keep async handling explicit. Use type-only imports
for type-only dependencies.

## Refactoring

- Refactor toward a better architecture: high cohesion, low coupling, abstractions and seams that
  make future change cheap. Judge each change by whether the design is genuinely improved — not by
  how much or how little it abstracts; either can be right. The goal is the cleaner architecture.
- No compat shims, alias re-exports, dual paths, or deprecated wrappers for moved internal code.
  Update callers and tests directly.
- Smells are fixed when found, never deferred — properly, with the right mechanism, not a stopgap.
  Deferral compounds — more code accretes around the smell, the fix only gets harder.

## Testing

Tests should assert observable behavior and meaningful invariants. A behavior change should come
with a test that would fail if the behavior regresses. Test code can be more direct than production
code when that keeps the test readable.

Keep tests focused on public behavior contracts, domain policies, core storage invariants, and
architecture boundaries. During refactors, update tests to follow the new structure instead of
preserving the old internal shape. Do not add compatibility tests for unshipped internals, moved
files, old names, or temporary refactor paths.

Avoid one-test-per-wrapper forwarding checks. Test wrappers only when they transform input, own
error behavior, or expose a stable user-facing contract that is not already covered by integration
tests or the type system.

## Documentation

Put written content where its lifespan matches:

- `docs/` (git-tracked) — durable design decisions: the "why" behind architecture and choices.
  `docs/design/` holds the design-decision records. This is the source of truth that outlives any
  workstream.
- `experiments/<name>/` (git-tracked) — the playground's own record (`README.md` / `PROGRESS.md` /
  `TEST-MODEL.md`); lives with the experiment, deleted when it's ported to production.
- `_local/` (git-ignored) — ephemeral local-only handoff/resume notes for a workstream. Not a
  contract; point at `docs/`, don't duplicate decisions here.

Rule of thumb: outlives the workstream → `docs/`; the experiment's validation record →
`experiments/<name>/`; "where are we now / what's next" → `_local/`.
