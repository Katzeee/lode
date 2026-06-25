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
- `packages/ipc/transport` (`@lode/transport`) owns bytes and connections only.
- `packages/ipc/client` (`@lode/client`) is the caller-facing facade over transport.
- `packages/engine` (`@lode/engine`) is the transport-free core: `src/core` owns block tree, text,
  props, history, and CRDT sync primitives; `src/domain` owns product semantics and policies;
  `src/services` owns RPC adapters; `src/dispatcher` is the in-process command bus. It must not
  import `@lode/transport` or `@lode/client`.
- `packages/ipc/daemon` (`@lode/daemon`) is a thin host that wraps the engine with a transport
  socket plus process lifecycle — the AppServer process. It owns transport connections and injects
  the engine's notification sink.
- `packages/test-utils` (`@lode/test-utils`) holds test helpers shared across packages.
- `apps/*` are deployable client surfaces (`app-cli` today; `app-gui`, `app-tui`, `app-mobile`
  later). Out-of-process surfaces reach the engine through `@lode/client`/`@lode/daemon`; an
  in-process surface (e.g. mobile) may use `@lode/engine` directly.

`@lode/engine` is the in-process service boundary; `@lode/daemon` exposes it as a local AppServer
process. Out-of-process clients may use `@lode/client`, `@lode/transport`, and `@lode/protocol`,
but must not import from `@lode/engine` source directly — to run a server they depend on
`@lode/daemon`. In-process clients (mobile) may depend on `@lode/engine`.

The intended desktop runtime is one local AppServer daemon per user. Clients may render or cache
local views, but workspace ownership and business logic stay behind the engine API.

Do not move product concepts into `packages/engine/src/core`. If a concept knows about product
semantics, including supertags, fields, queries, sessions, subscriptions, or UI behavior, it
belongs above the engine.

Engine-internal dependencies must point one way: `services -> domain -> core`. `core` must not
import from `domain`, `services`, `protocol`, or product policy modules. `domain` may use `core`
primitives, but must not register RPC methods, send notifications, or shape wire DTOs. `engine`
must not import `@lode/transport` or `@lode/client`; transport lives in `@lode/daemon`.

`packages/engine/src/services` should register methods, validate params, load the target
document/context, call domain functions, map results to protocol DTOs, and emit notifications. It
should not own outline, ref, schema, field, managed-child, reconcile, or hard-delete semantics.

When refactoring, optimize for clean boundaries over backward compatibility with unshipped
internals. Do not add compatibility shims, alias modules, dual paths, or deprecated wrappers for
moved internal code. Update callers and tests directly. If a stable public contract must change to
preserve the architecture, change the contract and its callers together instead of hiding the
mismatch behind adapters.

## Code Style

Prefer small, explicit code over abstractions that only organize names. Comments should explain
why something is non-obvious, not restate what the code does.

Avoid `any`; use `unknown` and narrow it. Keep async handling explicit. Use type-only imports
for type-only dependencies.

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
