# Engine Boundary Decisions

This document records the stable decisions that keep `Engine` close to BlockSuite's store
layer while the product grows into a local-first, Tana-like notes app.

Product concepts such as supertags, fields, queries, sessions, subscriptions, and UI behavior
belong above `Engine`.

## Core Boundary

`Engine` owns CRDT/store primitives:

- block creation, deletion, movement, and tree queries
- text and prop mutations
- history primitives
- CRDT update import/export and version exchange

It does not own product semantics. If an API needs to understand a supertag, field definition,
query result, selection, client session, or notification subscription, put it in AppServer
services instead.

## Process Boundary

Clients do not share memory with the engine. Public engine-facing APIs should use serializable
IDs and values, not live model objects, proxies, or reactive references.

This is why blocks are returned as snapshots or lightweight read views. Clients re-query or
subscribe through AppServer instead of holding live CRDT-backed objects.

## Block Model

Blocks are schema-agnostic outliner nodes. A block is content, props, and children. Type-like
meaning is represented above the engine, usually as props interpreted by services or clients.

The engine should not grow a block flavour registry or parent-child schema validator. Those rules
would make the store layer aware of product vocabulary.

## Tree Semantics

The engine uses Loro's native tree primitive. That gives us conflict-free tree moves and removes
the need for a flat map plus synthetic child arrays.

There are no true orphan blocks. Deleting a block must either delete or explicitly move its
children according to the engine API.

## Selection And Sessions

Selection is not document state. It is ephemeral per-client state and belongs in the AppServer
session layer.

Remote cursors, awareness, scroll state, drag previews, IME drafts, and other transient UI state
must not be stored in `Engine`.

## Sync And Notifications

CRDT sync primitives may live on the engine because each engine instance owns one Loro document.
Workspace-level code can delegate per document.

Semantic notifications are not durable sync history. A `block/updated` style event is useful for
rendering, but reconnect and catch-up must rely on Loro update or version exchange.

## Extensions

Engine extensions are only for behavior the engine needs to perform CRDT/store operations, such
as history integration or lifecycle hooks.

Command routing, schema/product validation, rendering, sessions, and subscription management
belong above the engine.

## Serialization

Serializers should prefer snapshots and pure functions over live engine access. Revisit this only
if streaming or incremental serialization becomes a real requirement.
