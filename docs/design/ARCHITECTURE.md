# Architecture

## Product Shape

A local-first, Tana-like note management app with a headless AppServer at its center.

The product direction includes outliner workflows, supertags, fields, queries, and multiple
client surfaces. Clients render state and send commands. AppServer owns the local workspace
service.

`Engine` is only the CRDT/store layer. It must not know about Tana-like product concepts.

## Structure

```
     CLI              TUI              GUI              Mobile
      \                |               /                /
       \               |              /                /
        ───────  AppServerClient  ──────────────────────
                        |
                   proto (via connectrpc)
                        |
                    AppServer (daemon)
                   ├─ runtime (App/Component/ChildApp composition + workspace registry)
                   ├─ services (RPC handlers)
                   ├─ domain (product semantics)
                   └─ core (engine + storage)
                        └─ Engine (1 per workspace)
                             ├─ BlockStore (ShardedBlockStore)
                             │    ├─ treeDoc  (structure + ownership + tombstones + occId)
                             │    └─ shard*   (256 content docs, virtual-bucket assigned)
                             │
                             └─ ActionHistory (snapshot-diff undo/redo)
                                  └─ per-action: before/after of affected occurrences (by occId)
                                     undo = reconcile(before) forward through Engine mutators
```

**AppServerClient** is a shared library. All frontends use it. No frontend imports
`server/src/` directly. In-process clients (mobile) may use `@lode/engine` directly.

## Package Layout

| Package           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lode/protocol`  | Wire contract only: method names, schemas, DTOs. Language-neutral.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `@lode/client`    | Caller-facing RPC client (wraps `@connectrpc/connect-node`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@lode/engine`    | Transport-free core, layered: `core` (block tree, text, props, history, CRDT sync primitives); `persistence` (storage primitives); `domain` + `domain/model` (product semantics + value types); `bundle` (built-in schema); `utils/crypto` (Ed25519/X25519/AES-256-GCM/BIP-39 leaf); `event` + `session` (notifications/sessions); `services` (RPC adapters); `runtime` (App/Component composition + in-process sync core + the wire-security/SyncProfile content layer the transport consumes). This is the future Rust dynamic library. |
| `@lode/transport` | Shared sync transport shell: the workspace-routing broker (client + `--relay` server) over real WebSockets + the `SyncTransport` adapter over it. A pure socket shell — the content/security layer (transit-key AEAD, actor wire signing, SyncProfile codec) is imported from `@lode/engine`. Used by daemon + mobile.                                                                                                                                                                                                                    |
| `@lode/daemon`    | Thin host: wraps engine with a transport socket + process lifecycle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/app-cli`    | Deployable CLI surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Invariants

These never change.

**1. AppServer is the service boundary.**
The active workspace lives behind the AppServer API. Clients may cache or render local views,
but commands go through the daemon service boundary.

**2. One protocol, multiple transports.**
All clients speak the same RPC contract from `protocol`. Transport is a deployment detail, not
an API detail.

**3. Engine stays product-agnostic.**
`core` owns block tree, text, props, history, and CRDT sync primitives. Product semantics
(supertags, fields, queries, sessions, subscriptions) live in `domain` or `services`, never
in `core`.

**4. Layering is one-way.**
`runtime → services → {domain, event, session} → core`, with `persistence`, `domain/model`, and
`bundle` as pure leaves and `event`/`session` sitting below `services` (`event` imports only the
protocol; `session` imports `event` + protocol). `core` must not import from `domain`, `services`,
`protocol`, or any transport. `domain` may use `core`/`bundle`/`domain/model` primitives. `engine`
must not import `@lode/client` or `@lode/transport`. Enforced automatically via ESLint
`no-restricted-imports` (one non-overlapping config block per layer).

**5. One doc per workspace.**
`Workspace.createDoc` throws if a doc already exists. The "doc" concept in the protocol is
vestigial (always one per workspace). Doc lifecycle RPCs (`createWorkspaceDoc`,
`removeWorkspaceDoc`, `listWorkspaceDocs`) remain for discovery; per-op RPCs carry no `doc_id`.

**6. Notifications are not sync history.**
Semantic notifications are UI events (per-workspace subscription). Reconnect and durable sync
must rely on CRDT update or version exchange, not replayed UI notifications.

**7. Headless by default.**
The AppServer has no UI dependency. Every frontend is optional and external.

**8. Clients are thin.**
Business logic lives in the AppServer. Clients render and dispatch commands.
