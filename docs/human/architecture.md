# Architecture Context

This document gives people a compact mental model of Lode. It is not an implementation contract
and may lag behind the code. The code, tests, generated contracts, enforced dependency rules, and
current product decisions determine actual behavior.

## System boundary

Lode is local-first. Its application surfaces communicate with a headless, embeddable Engine through
a serializable, transport-neutral contract whose source of truth is protobuf. Generated types define
the commands, queries, results, events, Workspace Session operations, and replica-exchange messages
used across implementation languages. The SDK provides an ergonomic Engine client surface,
validation, and generated-message adaptation without redeclaring DTO fields or depending on an
Engine implementation. Hosts may use in-process, native, IPC, or network adapters without creating
different application semantics. An adapter translates boundary concerns; it does not become a
second home for domain rules.

The Engine is the application core rather than a business-agnostic storage wrapper. It owns domain
commands and validation, workspace state, persistence coordination, queries, and change
publication. Apps own presentation and genuinely client-local interaction state.

An Engine Host creates and closes an Engine instance and supplies its platform resources. The Engine
owns Workspace Sessions, domain state, persistence coordination, and replica-exchange semantics;
the host owns process or application lifetime, platform integration, and connection orchestration.
The desktop Daemon is one Engine Host per Lode Home. CLI, GUI, and TUI surfaces reach it through the
shared desktop client and do not own domain authority. A host that embeds the Engine reaches the same
application contract without requiring a Daemon.

The protobuf boundary separates five relationships. `EngineService` carries application commands,
queries, results, and events. `EngineWorkspaceService` controls Engine-owned Workspace Sessions.
`ReplicaSyncService` carries the profile, fetch, and send primitives used by Engine-owned replica
exchange, and `EngineLifecycleService` gives a host an explicit release boundary for an embedded
Engine. `DaemonService` contains only desktop-host operations such as remote connection orchestration
and process shutdown. This split allows Engine and Daemon implementations to vary independently
while preserving the same generated contracts.

Repository placement follows deployment ownership. `apps` contains executable composition roots;
`packages` contains reusable modules. The daemon process entry and CLI therefore live as apps,
while the SDK, Engine, daemon host, desktop client, protocol, and logging modules remain packages.

## State authority

The Loro-backed FactStore is the sole replicated authority for domain state. A domain change adds a
fact; correction and undo add compensating facts instead of rewriting synchronized history. Facts
are retained so replicas can merge their histories without depending on a lossy summary.

Origin, Review, indexes, caches, checkpoints, and materialized shards are derived views. They may be
persisted for performance, but they are versioned and rebuildable from facts and never become a
second source of truth. Events notify consumers that something happened; they are not durable state
and cannot be used as synchronization history.

An accepted write becomes durable before success is reported, and subsequent reads through the
same Engine observe it. Imported and locally produced facts pass the same domain-validity boundary;
transport delivery alone does not make a fact valid.

The authority boundary admits complete Fact transactions. A normal one-Fact write uses an implicit
singleton transaction, while a domain edit that expands into inseparable assertions persists their
shared transaction identity, order, and size. Replication may deliver those Facts independently,
but no partial transaction enters an authoritative snapshot, Review decision, or related-Fact
query.

## Runtime ownership

Lifecycle ownership and capability dependencies are different relationships. Every mutable runtime
unit, resource, admitted operation, background task, subscription, and child runtime has one
lifecycle owner. Registries may index an owned unit but do not acquire the right to stop it.

Shutdown rejects new work, drains accepted work while its dependencies remain available,
checkpoints only cleanly drained state, and then releases the ownership subtree once. Construction
is atomic: a unit is published only after it starts successfully, and failure releases everything
it acquired.

## Synchronization and identity

Synchronization moves FactStore history between replicas; it does not introduce a central domain
authority. A relay, when used, routes opaque traffic and remains content-blind and untrusted.
Membership, cryptographic verification, and domain validation are enforced at the participating
replicas rather than delegated to the relay.

An actor identifies the person or principal responsible for a change. A replica is a
workspace-scoped causal writer, while a peer identifies a device or data-root synchronization and
transport endpoint. Keeping these identities distinct allows one actor to use multiple revocable
devices without turning transport identity into domain causal identity.
