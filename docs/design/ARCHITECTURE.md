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
                   ├─ runtime (Lifecycle/Component/ChildLifecycleComponent composition + workspace registry)
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

## Invariants

These never change. Package boundaries, the one-way layering rule, and "engine is
business-agnostic" are **authoritative in [`AGENTS.md`](../../AGENTS.md)** (enforced by ESLint
`no-restricted-imports`) — they are not restated here. The invariants below are the architectural
ones that do not follow from layering alone.

**1. AppServer is the service boundary.**
The active workspace lives behind the AppServer API. Clients may cache or render local views,
but commands go through the daemon service boundary.

**2. One protocol, multiple transports.**
All clients speak the same RPC contract from `protocol`. Transport is a deployment detail, not
an API detail.

**3. One doc per workspace.**
`Workspace.createDoc` throws if a doc already exists, and `createWorkspace` auto-inits that single
content doc (`"main"`). So the "doc" concept never reaches the protocol: there are no doc-lifecycle
RPCs, the `WorkspaceCoordinate` carries no doc id, and per-op RPCs carry only `workspace_id`.

**4. Notifications are not sync history.**
Semantic notifications are UI events (per-workspace subscription). Reconnect and durable sync
must rely on CRDT update or version exchange, not replayed UI notifications.

**5. Headless by default.**
The AppServer has no UI dependency. Every frontend is optional and external.

**6. Clients are thin.**
Business logic lives in the AppServer. Clients render and dispatch commands.
