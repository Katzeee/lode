# Architecture

## Product Shape

A local-first, Tana-like note management app with a headless AppServer at its center.

The product direction includes outliner workflows, supertags, fields, queries, and multiple
client surfaces. Clients render state and send commands. AppServer owns the local workspace
service.

`Engine` is only the CRDT/store layer. It must not know about Tana-like product concepts.

## Structure

```
     CLI              TUI              GUI
      \                |               /
       \               |              /
        ───────  AppServerClient  ───────
                        |
             newline-delimited JSON
             over supported transports
                        |
                    AppServer
                   ├─ services
                   └─ core workspace
                        └─ Engine (one per doc)
                             └─ BlockDoc (Loro CRDT)
```

**AppServerClient** is a shared library. All frontends use it. No frontend imports
`server/src/` directly.

## Invariants

These never change.

**1. AppServer is the service boundary.**
The active workspace lives behind the AppServer API. Clients may cache or render local views,
but commands go through the daemon service boundary.

**2. One protocol, multiple transports.**
All clients speak the same RPC contract from `protocol`. Transport is a deployment detail, not
an API detail.

**3. Engine stays product-agnostic.**
`server/core` owns block tree, text, props, history, and CRDT sync primitives. Product semantics
such as supertags, fields, queries, sessions, and notifications live above it.

**4. Daemon first.**
The intended runtime is one local AppServer daemon per user. Client surfaces are wrappers around
that service, not independent owners of state.

**5. Notifications are not sync history.**
Semantic notifications are UI events. Reconnect and durable sync must rely on CRDT update or
version exchange, not replayed UI notifications.

**6. Headless by default.**
The AppServer has no UI dependency. Every frontend is optional and external.

**7. Clients are thin.**
Business logic lives in the AppServer. Clients render and dispatch commands.
