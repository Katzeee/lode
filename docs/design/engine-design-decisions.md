# Engine Design Decisions

This document records the stable decisions that shaped `@lode/engine`'s core. It explains
**why** things are the way they are — the constraints and trade-offs that led to each choice.

## Engine Boundary

`Engine` owns CRDT/store primitives:

- block tree (create, delete, move, query)
- rich text (replaceDeltas, mark/unmark)
- props and meta (entity-level shared, occurrence-level isolated)
- history (snapshot-diff undo/redo)
- CRDT sync primitives (export/import/version)

It does **not** own product semantics. If a concept knows about supertags, field definitions,
queries, sessions, or UI behavior, it belongs in `domain` or `services` — above the engine.

## Entity / Occurrence Model

An **entity** (node) is the identity + content unit: nodeId, deltas (rich text), entity props,
entity meta. It is shared — all occurrences of the same node see the same content/props/meta.

An **occurrence** is a position in the tree. Each occurrence has:

- `occurrenceId` — the live Loro tree-node id (opaque, unstable across delete/recreate).
- `occId` — a **permanent** app-level identity (stored in the tree node's data, survives
  delete/recreate via `occIdOverride`). This is the key that snapshot-diff undo reconciles by.
- `parentOccurrenceId`, `physicalChildOccurrenceIds` — tree position.
- `occurrenceProps`, `occurrenceMeta` — per-occurrence (isolated; not shared across occurrences
  of the same node).

**Transclusion** = one entity appearing at multiple tree positions (multiple occurrences). This
is a first-class concept. Content/props/meta are entity-level (shared); occurrence-level data
is isolated.

## Sharded Storage

State is split across many LoroDocs so structure and content can load/sync independently:

- **treeDoc** — the occurrence tree (structure: parent/child/position), ownership map
  (nodeId → permanent virtual bucket), tombstones (hard-delete GC), and per-occurrence data
  (occId, occurrenceProps, occurrenceMeta).
- **shards** (256 by default) — content docs, each holding a subset of entities (by virtual
  bucket `hash(nodeId) mod 4096`). An entity (content + props + meta) lives in exactly one shard.

**Virtual buckets (P=4096)**: ownership stores a node's permanent bucket, not the shardId.
Raising `numShards` = regrouping buckets into more shard docs (power-of-two split-doubling),
no re-hashing. `numShards=256` is the default.

**Reconcile on restart**: `reconcileDurability()` runs to a fixpoint after loading, healing
create/delete orphans between treeDoc and shards (a crash between their writes leaves two kinds
of orphan). `validateSnapshot(toJSON(doc))` then rejects anything reconcile cannot heal.

## Undo / Redo (Snapshot-Diff)

The engine uses **snapshot-diff** undo (anytype-heart style), not command-inverse. The old
command-inverse model had a structural bug: descriptors stored parent as a nodeId and
re-resolved to the canonical occurrence at apply time, which was imprecise under multi-occurrence
transclusion.

**How it works**:

- Each action captures the before/after state of ONLY the **changed** occurrences and entities
  (diffed from full DocSnapshots at `begin()`/`end()`, keyed by permanent `occId`).
- **Undo** restores the before-state forward through Engine mutators (events fire), bottom-up:
  recreate deleted occurrences (with original occId/nodeId via override), delete added ones,
  move reparented ones back, restore content/props/meta/canonical. One reconciliation pass.
- **Redo** restores the after-state.
- **Batch undo**: `engine.transact(fn)` wraps multiple ops in one `begin()`/`end()` pair → one
  action → one undo step. `transact`/`batch` is **re-entrant (nest-safe)** — a batch inside a
  batch joins the outer group — so a grouped primitive (e.g. a cascade delete) called inside
  another grouped op stays one undo step. This is how `domain/editing/` composite ops
  (paste/duplicate/indent/outdent/moveSibling) and the cascade/clone primitives group by intent.

**Storage** ∝ change-size (not doc-size): only changed occurrences/entities are stored per action.
The undo stack is in-memory (ephemeral); persistence is the CRDT change log (treeDoc + shards).

**Why snapshot-diff over command-inverse**: for batch undo (N ops as one step), snapshot-diff
reconciles in ONE pass (one piece of logic, one failure point). Command-inverse would apply N
separate inverses in reverse order (N failure points). For single-op undo they're equivalent;
for batch undo, snapshot-diff is more robust.

## Cascade (Domain-Level Delete)

`domain/node.ts` `removeOccurrenceOrHardDelete` / `hardDeleteNode` is a bounded-worklist cascade:

- `cascadeClosure` — pure worklist traversal (no mutation): an occurrence drags its physical
  subtree; a **canonical** occurrence drags every occurrence of its node. A `removed` set bounds
  the work (transcluded nodes are enqueued many times, processed once).
- `applyCascade` — applies the closure through Engine mutators to a fixpoint, bottom-up:
  `removeOccurrence` for leaf occurrences, `deleteNode` for killed nodes once their occurrences
  are leaves.

This replaced a recursive cascade that crashed under multi-occurrence transclusion (it revisited
already-deleted occurrences). Verified by `cascade-exhaustive.test.ts` (every tree size 2–4 ×
every transclusion partition × every op, against an independent brute-force survivor spec).

## Testing Philosophy

**Independent oracles, not self-referential tests.** The engine's correctness is proven by:

1. **TruthModel fuzz** (`tests/correctness.test.ts`) — a hand-written oracle from the prose
   semantics (not from any store). After every op, the engine's snapshot must equal the model's
   projection. Covers all 18 public mutators. 60 seeded scripts × 5 shard counts. Includes a
   negative control (stale model is caught) and an undo/redo round-trip property.

2. **cascade-exhaustive** — independent brute-force survivor spec for the domain cascade. Every
   tree × partition × op matches, zero throws.

3. **validateSnapshot** — structural invariant checker (cycles, parent↔child, canonical,
   orphan, occId uniqueness). Run after every op in the fuzz + on load (restart).

4. **durability tests** — crash recovery via the lazy `shardLoader` hook.

## Process Boundary

Clients do not share memory with the engine. Public APIs use serializable IDs and values, not
live model objects. Blocks are returned as snapshots or lightweight read views. Clients re-query
or subscribe through the daemon.

## What Does NOT Belong in the Engine

Selection (ephemeral, per-client), cursors, awareness, scroll state, drag previews, IME drafts,
command routing, schema/product validation, rendering. These live above the `core` engine — in
`domain`, `session`, or `services` inside the package, or in the client for purely ephemeral
per-client view state.

## Internal Layering & Component Composition

The `@lode/engine` package is layered one way (enforced by ESLint `no-restricted-imports`, one
non-overlapping config block per layer):

```
runtime -> services -> {domain, event, session} -> core
domain  -> {core, bundle, domain/model}
leaves  : persistence, domain/model, bundle   (no engine imports)
event   -> protocol        session -> {event, protocol}
```

- **`core`** — block tree, text, props, history, CRDT sync primitives. Product-agnostic.
- **`persistence`** — storage primitives (SQLite CRUD on opaque bytes/records). Pure leaf.
- **`domain/model`** — the domain's shared value types (change / identity / provenance vocabulary),
  zero engine imports. Mirrors anytype-heart's `core/domain` pure-type leaf.
- **`domain`** — product semantics and policies as functions over `core` (node, schema, field,
  managed-child, cascade). Functional-on-core, not object-oriented.
- **`bundle`** — declarative built-in schema vocabulary (system entity meta keys + field types),
  the single source of truth for built-in supertags/fields. Mirrors anytype-heart's `pkg/lib/bundle`.
- **`event`** / **`session`** — the notification primitive and the session/subscription/broadcast
  layer above it; both sit below `services` so RPC adapters can use them without circular deps.
- **`services`** — RPC adapters (validate → load → call domain → map to DTO → emit via session/event).
- **`runtime`** — composition root: the `App`/`Component`/`ChildApp` graph, `createAppRuntime`,
  the per-workspace registry, and the in-process sync core (`SyncManager` + `SyncTransport` seam —
  see § Sync).

**Component composition** (`runtime/app.ts`) mirrors anytype-heart's `app.Component` / `app.App`,
adapted to TypeScript: constructor injection instead of Go's service-locator lookup. A `Component`
is a named subsystem with optional async `start`/`stop`; the `App` starts components in registration
order and stops them in reverse. Each loaded workspace is a `ChildApp` whose components (workspace +
store) stop independently on unload, and which is the mounting point for per-workspace subsystems
(the in-process sync core already mounts here; indexer/query-cache will plug in the same way). The
graph is intentionally lean; it exists so subsystems mount uniformly instead of each bolting on
ad-hoc wiring.

**Deliberately not aligned with anytype:** the data model stays functional-on-core + sharded Loro
CRDT (not SmartBlock OO + any-sync's change-DAG), and there is no object-type/dispatch seam yet —
lode has one structural object type (a node), so a per-type editor hierarchy would have no client.
That seam earns its place only when behaviorally-distinct object types (e.g. query/dataview nodes)
appear.

## Sync (in-process CRDT core)

A Loro/VV-based CRDT sync core, matching any-sync's **semantics + structure** but NOT its
change-DAG mechanism (lode is Loro-based, so it uses Loro's per-doc version vectors directly — no
bloom-filter head-diff needed). Scope: a verified in-process core; the real network transport lives
in the engine (`src/runtime/broker/` — the `BrokerSyncProtocol` adapter over the
workspace-routing broker).

- **Sync unit** = a workspace doc = `treeDoc ("main") + N shards`, each an independent `LoroDoc`
  with its own version vector. `ShardedBlockStore.syncDocs()` exposes the per-doc `SyncDoc` surface
  (version + export/import) — the seam a sync manager plugs into.
- **`SyncManager`** (`runtime/sync.ts`) drives one round with a peer over a `SyncTransport`:
  treeDoc **first** (it carries ownership → reveals which shard ids exist), then the **union** of
  local + remote shard ids (materializing any the treeDoc sync revealed), exchanging both
  directions per doc (push captured before pull, so it never echoes the peer's own ops). One round
  converges a pair.
- **`sweepOrphans`** — ownership-based post-sync heal: drops live occurrences whose node's
  ownership was hard-deleted on a peer (the concurrent ref+delete orphan), and tombstones orphan
  entities. Deliberately ownership-based (not entity-based like crash-recovery
  `reconcileDurability`) so a shard merely pending delivery is NOT swept — partial delivery
  self-heals when the shard arrives.
- **`SyncTransport`** is the network seam. The production adapter is `BrokerSyncProtocol`
  (`src/runtime/broker/`, engine-internal); an `InMemorySyncTransport` + `syncPair` drive the
  in-process core + tests.

**Testing** is truth-based, not differential (comparing to another implementation only proves
equality, not correctness): contract properties (convergence, validity, conservation,
determinism, no-resurrection) + spec-defined concurrent-op outcomes, over a smoke/truth/chaos/
gc-partition suite + an exhaustive 64-pair op grid + convergence fuzz. See `tests/sync/`. Known
gaps (review follow-ups, not blockers): move-under-concurrently-deleted → cascade removal (pinned);
tombstone-grace GC is dead state (no prune); id-collision bounded by the global-uniqueness
contract; mid-partial-sync read throws (matters once sync is async).
