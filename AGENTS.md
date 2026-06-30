# Development Guide

## Project Identity

This project is a local-first, Tana-like note management app. Plain nodes are the primary content
units, refs are first-class product objects, and schema/fieldDef/field model supertag-like
structure. Product services are exposed to multiple client surfaces by `@lode/engine`, a
transport-free core library; `@lode/daemon` hosts that engine as a local AppServer process for
out-of-process clients, while mobile/embedded clients may use the engine in-process.

`Engine` is intentionally business-agnostic: it should stay close to BlockSuite's store layer,
owning block tree, text, props, history, and CRDT sync primitives without knowing about Tana-like
concepts.

## Boundaries

- `packages/protocol` (`@lode/protocol`) is the wire contract only: method names, schemas, DTOs,
  errors. It is the one package that must stay language-neutral — the contract a future rewrite in
  another language would have to preserve.
- `packages/ipc/client` (`@lode/client`) is the caller-facing RPC client (wraps
  `@connectrpc/connect-node`).
- `packages/engine` (`@lode/engine`) is the transport-free core, layered one way (enforced by
  ESLint, see below): `src/core` owns block tree, text, props, history, and CRDT sync primitives;
  `src/persistence` owns storage primitives (SQLite CRUD on bytes/records — no engine imports);
  `src/domain/model` is the pure value-type leaf (shared domain vocabulary, zero engine imports);
  `src/domain` owns product semantics and policies (functions over `core`); `src/bundle` is the
  declarative built-in schema vocabulary (pure leaf); `src/utils/crypto` is the crypto leaf
  (Ed25519 / X25519 / AES-256-GCM / BIP-39 / SLIP-10 — `node:crypto` + `@noble/curves` +
  `@scure/bip39`, no engine internals; the standardized layer that travels inside the engine when
  it is rebuilt as a Rust dynamic library); `src/event` owns notification primitives;
  `src/session` owns session/subscription/broadcast; `src/services` owns RPC adapters; `src/runtime`
  is the composition root (the `App`/`Component`/`ChildApp` graph, `createAppRuntime`, the
  per-workspace registry, the in-process sync core, and the wire-security/SyncProfile content layer
  the transport consumes). It must not import `@lode/client`.
- `packages/ipc/daemon` (`@lode/daemon`) is a thin host that wraps the engine with a transport
  socket plus process lifecycle — the AppServer process. It owns transport connections and injects
  the engine's notification sink.
- `packages/transport` (`@lode/transport`) is the shared sync transport SHELL: the
  workspace-routing broker (client + `--relay` server) over real WebSockets + the `SyncTransport`
  adapter over it. It is a pure socket shell — the content/security layer (transit-key AEAD seal/
  open, actor wire signing, the membership→wire bridge, the SyncProfile codec) lives in
  `@lode/engine` now and is imported from there. It depends on `@lode/engine` and is used by BOTH
  `@lode/daemon` and in-process mobile — mobile dials a relay directly, so the transport cannot
  live daemon-only. The engine must not import it.
- `apps/*` are deployable client surfaces (currently: `app-cli`). Out-of-process surfaces reach
  the engine through `@lode/client`/`@lode/daemon`; an in-process surface (e.g. mobile) may use
  `@lode/engine` + `@lode/transport` directly.

`@lode/engine` is the in-process service boundary; `@lode/daemon` exposes it as a local AppServer
process. Out-of-process clients may use `@lode/client` and `@lode/protocol`, but must not import
from `@lode/engine` source directly — to run a server they depend on `@lode/daemon`. In-process
clients (mobile) may depend on `@lode/engine` + `@lode/transport` (mobile dials a relay directly via
`@lode/transport`, with no daemon).

The intended desktop runtime is one local AppServer daemon per user. Clients may render or cache
local views, but workspace ownership and business logic stay behind the engine API.

Do not move product concepts into `packages/engine/src/core`. If a concept knows about product
semantics, including supertags, fields, queries, sessions, subscriptions, or UI behavior, it
belongs above the engine.

Engine-internal dependencies point one way, enforced automatically by ESLint
`no-restricted-imports` (each layer is a non-overlapping config block):

```
runtime -> services -> {domain, event, session} -> core
                       \--> protocol
domain  -> {core, bundle, domain/model}
leaves  : persistence, domain/model, bundle, utils/crypto  (no engine imports)
event   -> protocol      session -> {event, protocol}
```

`core` must not import from `domain`, `services`, `protocol`, or any product layer. `domain` may
use `core`/`bundle`/`domain/model` but must not register RPC methods, send notifications, or shape
wire DTOs. `services` is the RPC adapter layer; `runtime` is the composition root and may import
every internal layer. `engine` must not import `@lode/client` or `@lode/transport` (the sync transport);
transport responsibility lives in `@lode/daemon` and `@lode/transport`.

`packages/engine/src/services` must not own domain semantics (those live in `domain`) nor
connection/subscription lifecycle (that lives in `session`).

## Code Style

Prefer small, explicit code over abstractions that only organize names. Comments should explain
why something is non-obvious, not restate what the code does.

Avoid `any`; use `unknown` and narrow it. Keep async handling explicit. Use type-only imports
for type-only dependencies.

## Refactoring

- No compat shims, alias re-exports, dual paths, or deprecated wrappers for moved internal code.
  Update callers and tests directly.
- No production scaffolding without callers (debug modes, metrics, helpers with no consumer).
  Delete what isn't exercised today.

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

Three places for written docs, by lifespan — put content where its lifespan matches:

- `docs/` (git-tracked) — **durable design decisions**: the "why" behind architecture and
  choices, retained after the feature ships. `docs/design/` holds the design-decision records.
  This is the source of truth that outlives any one workstream. Write decisions here, not
  transient implementation state.
- `experiments/<name>/` (git-tracked) — **the playground's own record**: `README.md` (what it
  is / status / key files), `PROGRESS.md` (phase log), `TEST-MODEL.md` (test methodology). It
  lives with the experiment and is deleted when the experiment is ported to production and the
  directory removed. Put playground-coupled content (what was validated, how) here, not in
  `docs/`.
- `_local/` (git-ignored) — **local-only handoff / resume notes** for multi-person
  collaboration on a workstream: current state, what's done, what's next. Ephemeral — not a
  contract, not a substitute for `docs/`. Point at the durable docs; don't duplicate decisions
  here.

Rule of thumb: a decision that must outlive the workstream → `docs/`; the experiment's
validation record → `experiments/<name>/`; "where are we right now / what's next" → `_local/`.
