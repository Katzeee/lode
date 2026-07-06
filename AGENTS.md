# Development Guide

## Project Identity

This project is a local-first, Tana-like note management app. Plain nodes are the primary content
units, refs are first-class product objects, and schema/fieldDef/field model supertag-like
structure. Product services are exposed to multiple client surfaces by `@lode/engine`, the core
library (block tree + CRDT + the peer-sync broker wire); `@lode/daemon` hosts that engine as a local
AppServer process for out-of-process clients, while mobile/embedded clients may use the engine
in-process.

`Engine` is intentionally business-agnostic: it should stay close to BlockSuite's store layer,
owning block tree, text, props, history, and CRDT sync primitives without knowing about Tana-like
concepts.

## Boundaries

- `packages/protocol` (`@lode/protocol`) is the wire contract only: method names, schemas, DTOs,
  errors. It is the one package that must stay language-neutral — the contract a future rewrite in
  another language would have to preserve.
- `packages/logger` (`@lode/logger`) is the cross-cutting logging facade — pino hidden behind a
  `Logger` type, JSON to stderr, per-prefix `LODE_LOG` levels (`sync=debug;engine.broker*=info;*=warn`).
  A neutral leaf every package may import (mirrors any-sync's `app/logger`); component identity in
  the logger name (`createLogger("sync.runner")`), runtime context in fields
  (`wsId`/`peerId`/`docId`/`relay`/`err`).
- `packages/ipc/client` (`@lode/client`) is the caller-facing RPC client (wraps
  `@connectrpc/connect-node`).
- `packages/engine` (`@lode/engine`) is the core library, layered one way (enforced by ESLint, see
  below): `src/core` owns block tree, text, props, history, and CRDT sync primitives;
  `src/persistence` owns storage primitives (SQLite CRUD on bytes/records — no engine imports);
  `src/domain/model` is the pure value-type leaf (shared domain vocabulary, zero engine imports);
  `src/domain` owns product semantics and policies (functions over `core`); `src/bundle` is the
  declarative built-in schema vocabulary (pure leaf); `src/utils/crypto` is the crypto leaf
  (Ed25519 / X25519 / AES-256-GCM / BIP-39 / SLIP-10 — `node:crypto` + `@noble/curves` +
  `@scure/bip39`, no engine internals; the standardized layer that travels inside the engine when
  it is rebuilt as a Rust dynamic library); `src/event` owns notification primitives;
  `src/session` owns session/subscription/broadcast; `src/services` owns RPC adapters; `src/runtime`
  is the composition root (the `App`/`Component`/`ChildApp` graph, `createAppRuntime`, the
  per-workspace registry, and the in-process sync core — `SyncManager` + `src/runtime/broker/`, the
  peer-sync wire (`BrokerClient`/`BrokerServer` over a Connect gRPC bidi stream, HTTP/2) + the
  it + the wire-security/SyncProfile content layer). The broker wire is engine-internal so it travels
  with the engine into a future Rust port. It must not import `@lode/client`.
- `packages/ipc/daemon` (`@lode/daemon`) is a thin host that wraps the engine with the gRPC IPC
  socket (`@connectrpc/connect-node`) + hosts the relay (`BrokerServer`, in `--relay` mode) plus
  process lifecycle — the AppServer process. It owns the client→core RPC connection and injects the
  engine's notification sink. The peer-sync wire + protocol live in the engine, not here.
- `apps/*` are deployable client surfaces (currently: `app-cli`). Out-of-process surfaces reach
  the engine through `@lode/client`/`@lode/daemon`; an in-process surface (e.g. mobile) may use
  `@lode/engine` directly (it dials a relay via the engine's broker client, no daemon).

`@lode/engine` is the in-process service boundary; it owns the peer-sync broker wire (Layer A —
between peers) so that wire travels with the engine into a future Rust port. `@lode/daemon` exposes
it as a local AppServer process. The client→core RPC (Layer B) is separate: out-of-process clients
use `@lode/client` and `@lode/protocol`, and must not import from `@lode/engine` source directly —
to run a server they depend on `@lode/daemon`. In-process clients (mobile) depend on `@lode/engine`
alone (mobile dials a relay directly via the engine's broker client, with no daemon).

The intended desktop runtime is one local AppServer daemon per user. Clients may render or cache
local views, but workspace ownership and business logic stay behind the engine API.

**Engine vs daemon — the deciding test.** Mobile/embedded consume `@lode/engine` in-process with no
daemon, so anything a consumer needs to function MUST live in the engine. The daemon holds ONLY
host-only concerns: process lifecycle, the IPC socket/connectionId, relay hosting (`--relay`), and
RPC handlers that genuinely need the `DaemonSyncRunner` (relay-connection lifecycle:
share/join/register/syncNow). For an RPC handler the test is: **does it need the runner or other
host-only machinery? If not, it belongs in `engine/src/services/`** — relay-independent adapters
(governance, identity, workspace lifecycle) go in the engine so an in-process host gets them too.
Equivalently: delete the daemon; if an in-process consumer can no longer do something it should be
able to, that something was wrongly placed in the daemon.

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
every internal layer. `engine` must not import `@lode/client`. The peer-sync wire + protocol are
engine-internal (`src/runtime/broker/`); the client→core RPC is `@lode/daemon`/`@lode/client`.

`packages/engine/src/services` must not own domain semantics (those live in `domain`) nor
connection/subscription lifecycle (that lives in `session`).

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

## Dependencies

Don't reinvent what a third-party library already covers. Adopt it when it does what we need
**without modification** AND its scope matches the problem (introducing it doesn't drag in large
unused surface). Hand-roll only when the library would need fork-level changes, or when its scope
far exceeds the feature we need — paying the weight for little of the capability. The decision and
rationale belong in `docs/design/`; current "adopt vs hand-roll" open questions belong in the
relevant `_local/handoff/` doc.

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

**Pre-commit verification.** The husky hook (`lint-staged` + `npm run typecheck`) is a fast per-commit
backstop — it does NOT run the test suite, so `npm test`-green alone is NOT enough (a type error
blocks the hook). Run `npm run verify` (typecheck + lint + test across workspaces) before pushing: it
is a superset of the hook, so `verify`-green ⇒ no commit-time surprise. Both assume workspace `dist`
is current — run `npm run build` after pulling or on a fresh clone.

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
