# Development Guide

## Project Identity

This project is a local-first, Tana-like note management app. Plain nodes are the primary content
units, refs are first-class product objects, and schema/fieldDef/field model supertag-like
structure. Product services are exposed to multiple client surfaces by `@lode/engine`, the core
library; `@lode/daemon` hosts that engine as a local AppServer process for out-of-process clients,
while mobile/embedded clients may use the engine in-process.

`Engine` is intentionally business-agnostic: it owns block tree, text, props, history, and CRDT
sync primitives without knowing about Tana-like product concepts.

## Boundaries

- `@lode/protocol` — the wire contract only: method names, schemas, DTOs, errors. Language-neutral.
- `@lode/logger` — the cross-cutting logging facade. A neutral leaf every package may import.
- `@lode/client` — the caller-facing RPC client.
- `@lode/engine` — the core library, layered one way (enforced by ESLint; see DAG). Must not
  import `@lode/client`.
- `@lode/daemon` — thin host: process lifecycle + the IPC socket + relay hosting. The peer-sync
  wire + protocol live in the engine, not here.
- `apps/*` — deployable client surfaces. Out-of-process surfaces reach the engine through
  `@lode/client`/`@lode/daemon`; an in-process surface uses `@lode/engine` directly (no daemon).

Engine sublayers (one-way, ESLint-enforced): `core` (block tree, text, props, history, CRDT
primitives — business-agnostic) ← `domain` (product semantics) ← `services` (RPC adapters) ←
`runtime` (composition root + the in-process peer-sync core). Pure leaves with no engine imports:
`persistence`, `domain/model`, `bundle`, `utils/crypto`. `event` = notification primitives;
`session` = session/subscription/broadcast.

Two wires, kept separate: **Layer A** is the peer-sync wire (engine-internal, between peers);
**Layer B** is the client→core RPC (`@lode/daemon`/`@lode/client`).

**Engine vs daemon — the deciding test.** Mobile/embedded consume `@lode/engine` in-process with no
daemon, so anything a consumer needs MUST live in the engine. The daemon holds ONLY host-only
concerns: process lifecycle, the IPC socket, relay hosting, and the RPC handlers that need
relay-connection lifecycle (share/join/register/syncNow). Every other RPC handler belongs in
`engine/src/services/`. Equivalently: delete the daemon; if an in-process consumer can no longer do
something it should be able to, that something was wrongly placed in the daemon.

Do not move product concepts into `core` — supertags, fields, queries, sessions, subscriptions, UI
behavior all belong above it.

```
runtime -> services -> {domain, event, session} -> core
                       \--> protocol
domain  -> {core, bundle, domain/model}
leaves  : persistence, domain/model, bundle, utils/crypto  (no engine imports)
event   -> protocol      session -> {event, protocol}
```

`core` may not import any layer above it. `domain` may use `core`/`bundle`/`domain/model` but must
not register RPC methods, send notifications, or shape wire DTOs. `services` is the RPC adapter
layer only (no domain semantics — those live in `domain`; no connection/subscription lifecycle —
that lives in `session`). `runtime` may import every internal layer.

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
