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
  action → one undo step. This is how the domain layer groups user-intent operations (paste,
  schema-apply, import) into a single undoable unit.

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
command routing, schema/product validation, rendering, sessions, subscription management. These
all live above the engine (in `domain` or `services`).
