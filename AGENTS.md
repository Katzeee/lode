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
- The project has no production data or released compatibility surface. Unless the user explicitly
  asks otherwise, changes do not preserve old data, APIs, durable storage formats, code paths,
  module locations, or behavior. Define the requested system in the present tense and update every
  caller, test, fixture, and generated contract directly; do not add migration paths.
- No compat shims, alias re-exports, dual paths, or deprecated wrappers for moved internal code.
  Update callers and tests directly.
- Smells are fixed when found, never deferred — properly, with the right mechanism, not a stopgap.
  Deferral compounds — more code accretes around the smell, the fix only gets harder.

## Module placement

Every unit has exactly one correct home, decided by what concept owns it — not by how many places
use it.

- Apex — depends on everything, depended on by nothing (public entry + composition root). The only
  files loose at `src` root.
- A layer's concept → that layer; layers above import downward.
- A neutral MODULE — a cohesive substrate with no layer semantics (crypto, persistence, errors) → its
  own leaf, named for what it is. It earns the leaf by being a real module, NOT by being portable or
  reused. Never a `base/`/`shared/`/`utils/` drawer: "depended on by many" is not a cohesion axis.
- A helper with no concept owner → lives with its concept-closest consumer, the one LOWER in the
  dependency graph (so the other consumer imports it one-way downward). Extract a separate helper file
  only for a cohesive cluster of related helpers, never on first reuse; one-offs are colocated or
  duplicated — never leafed and never dropped into a `util`/`common` drawer at any level.

Directory boundaries are dependency boundaries: two subdirectories that import each other are a FALSE
split — they aren't independent modules. Decouple (move the bridging adapter to the concept-owning
side, or introduce a seam) or merge; never leave a bidirectional import across directory boundaries,
and lock the one-way edge in eslint so it can't regress.

Test: does it carry a layer's semantics (→ that layer), is it a cohesive substrate module (→ its own
leaf), or is it a helper serving a specific consumer (→ that consumer; the lower one in the graph
hosts it)?

## Testing

Tests describe expected production behavior. Each test should have a clear requirement, use a
representative input or state transition, exercise the production entry point that owns the
behavior, and assert an observable result or invariant. Prefer domain rules, storage guarantees,
and architecture boundaries over incidental implementation details.

Place each guarantee at the most appropriate level. Before adding coverage, consider what the type
system, generated schemas, lint rules, and existing unit, acceptance, or end-to-end tests already
establish. Add another test when it covers a distinct input class, state transition, or outcome, or
when it provides materially clearer feedback.

Keep tests with their production owner and keep production surfaces for production callers. Test
setup should establish context rather than repeat the assertion, and helpers should not duplicate
the behavior being tested. During refactors, update or remove tests, helpers, fixtures, exports, and
temporary scaffolding together with the behavior they serve.

## Documentation

Documentation is deliberately sparse and its audience is explicit:

- `docs/agents/` (git-tracked) contains instructions or configuration intended for agents. Read the
  relevant material when using the corresponding tool or workflow.
- `docs/human/` (git-tracked) contains architecture context written for people. It is explanatory,
  non-authoritative, and may lag behind the implementation. Do not infer requirements from it or
  use it to resolve a disagreement with the user's request, the code, tests, generated contracts,
  or enforced architecture rules. Verify a statement against those live sources before relying on
  it in development.
- `experiments/<name>/` (git-tracked) contains only the playground's own validation record
  (`README.md` / `PROGRESS.md` / `TEST-MODEL.md`) and is deleted when the experiment is ported.
- `_local/` (git-ignored) contains ephemeral handoff and resume notes for a workstream. It is not a
  contract.

Human documentation earns its maintenance cost only when it explains a small number of durable
architectural boundaries or invariants. Do not preserve implementation snapshots, file trees,
class or message inventories, workstream status, rejected alternatives, supersession history,
compatibility or migration narratives, known-gap lists, or detailed product behavior there. The
implementation and its tests describe the present system; tickets and `_local/` material describe
work in progress.
