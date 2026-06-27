# Multi-shard single-tree engine — verification prototype

> **⚠️ SUPERSEDED — safe to delete.** All verified designs + tests have been ported to
> production (`packages/engine/src/core/sharded-store.ts`, `action-history.ts`,
> `sharding.ts`, `invariant.ts`, `block-store.ts`; `packages/engine/tests/`).
> The production engine runs sharded by default (see `docs/sharded-engine-migration.md`
> and `docs/test-coverage-audit.md`). This prototype is no longer maintained.

An isolated research prototype that **verifies the viability of a sharded
single-tree CRDT engine** for a Tana-like outliner. It is **not production code**
and is **not imported by `@lode/engine`** — it lives under `experiments/` (excluded
from the monorepo's workspaces, typecheck, and lint) and resolves
`loro-crdt`/`vitest` from the root `node_modules`.

The question it answers: **can we split an outliner's content across many CRDT
docs while presenting one always-structurally-correct single tree, and prove it
correct?** Yes — proven by differential testing against a known-correct
single-doc reference, plus independent-truth, durability, benefit, scale,
delivery-chaos, and cross-doc undo evidence. **126 tests, 20 files, all green.**

## The design

```
                    ┌─────────────────────────── ShardedEngine ───────────────────────────┐
   domain ───────►  │  OutlineApi (single tree, occurrence-ref, always structurally valid)  │
  (reconcile)       │                                                                       │
                    │  treeDoc  ── occurrenceTree (full structure)                           │
                    │            ── ownership    (nodeId → shardId, immutable per node)     │
                    │            ── tombstones   (hard-deleted nodeIds, for GC)             │
                    │                                                                       │
                    │  shard*   ── one content doc per shardId, entities keyed by nodeId    │
                    └───────────────────────────────────────────────────────────────────────┘
```

- **One `treeDoc`** is the single structural authority: the `occurrenceTree`
  (the global outline), an immutable `nodeId → shardId` ownership map, and a
  tombstone set. It stays small (no content) — the lazy-load win.
- **N content shards**, each a LoroDoc holding `entities` keyed by `nodeId`
  (text/props/canonicalOccurrenceId). Shard assignment is a deterministic hash
  of `nodeId`, so **every replica assigns the same node to the same shard** —
  ownership is derived/stored in the tree doc and converges with it, never
  splitting.
- **Transparent**: the domain never sees shard ids. The same `OutlineApi` is
  implemented by a **single-doc oracle** (`SingleDocEngine`) and the sharded
  engine. Occurrence ids are opaque (Loro mints per-doc TreeIDs), so equivalence
  is checked on a **topology-normalized projection**, not raw ids.

## Correctness contract: engine vs domain

| Correctness                                                      | Owned by   | How                                                      |
| ---------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Tree is always structurally valid (acyclic, well-formed)         | **engine** | `validateSnapshot` over the tree doc                     |
| occurrence↔entity referential integrity (at quiescence)          | **engine** | structural `f` spanning tree doc + shards                |
| canonical occurrence points back; survives move/delete           | **engine** | canonical stored on entity, resolved transparently       |
| Convergence across replicas                                      | **engine** | per-doc two-way CRDT exchange                            |
| Lazy-load transparency / no crash mid-sync / self-heal           | **engine** | content-pending tolerated; tombstone sweep               |
| GC safety (no data loss on concurrent delete+edit)               | **engine** | tombstones + `sweepTombstones` to a fixpoint             |
| **Domain semantics** (e.g. a schema field realized exactly once) | **domain** | `reconcileSchema` collapses duplicates deterministically |

The engine guarantees the tree is a _valid tree_. It does **not** guarantee
_domain_ correctness: two replicas concurrently adding a field slot yield two
slots — both structurally valid, semantically wrong. The domain `f`
(`reconcileSchema`) collapses them, picking survivor = min nodeId so replicas
agree without syncing the choice.

## Test plan & results

Run: `node_modules/.bin/vitest run --root experiments/multi-shard-tree` (from the
lode repo root). 126 tests, 20 files.

| Suite                  | Property                                             | Method                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1**                 | structural validity after **every** op               | replay op-by-op, validate each                                                                                                                                                                                          |
| **E2**                 | referential integrity at quiescence                  | `validateInvariants` everywhere                                                                                                                                                                                         |
| **E3**                 | mid-sync tolerance + self-heal                       | tree-doc-only sync (content pending), then full sync                                                                                                                                                                    |
| **E4**                 | **differential equivalence** sharded ≡ oracle        | 400 seeded scripts × {1,2,4,8} shards = 1600 cases, topology-normalized compare                                                                                                                                         |
| **E5**                 | multi-replica convergence                            | 3-replica hand-crafted, star topology, 60×5 fuzz                                                                                                                                                                        |
| **E6**                 | lazy-load transparency                               | shard fan-out, identical eager vs on-demand                                                                                                                                                                             |
| **E7**                 | no data loss (tombstone + concurrent delete/edit)    | delete wins consistently                                                                                                                                                                                                |
| **E9**                 | delivery robustness                                  | duplicate-import idempotency, out-of-order shards                                                                                                                                                                       |
| **E10**                | persistence/restart                                  | snapshot reseed reproduces state                                                                                                                                                                                        |
| **D1–D7**              | domain reconcile                                     | concurrent schema-add → one field; idempotence; order-independence; determinism; stale-prune; protection; schema-change propagation                                                                                     |
| **A1–A7**              | adversarial                                          | lost op, delete-vs-edit, ref+delete orphan (sweep), resurrect, move-vs-edit, restart-mid-sync, long partition                                                                                                           |
| **exhaustive**         | all 25 single-op pairs across 2 replicas             | converge + invariant-valid                                                                                                                                                                                              |
| **E-durability**       | crash recovery (`reconcileDurability`)               | create-direction + delete-direction crash orphans → invariant-valid fixpoint; converges with a healthy replica                                                                                                          |
| **cascade-exhaustive** | **independent truth** for the cascade                | every tiny tree × transclusion × every remove/hardDelete == brute-force fixpoint spec (not the engine's worklist)                                                                                                       |
| **domain-invariants**  | semantic truth, not just structure                   | ≤1 slot/field + no stale, over 200 fuzz seeds; idempotent + order-independent                                                                                                                                           |
| **scale**              | holds up at 10k+; converges; ~linear                 | 10k single + 2×10k multi-replica converge; high ref density; long partition; build/snapshot slope asserted linear (child-process isolated)                                                                              |
| **chaos**              | delivery chaos converges (CRDT commutativity)        | nodeId collision; concurrent tombstone; missing shard later; out-of-order; VV-lost re-sync; multi-client shard subsets — all converge                                                                                   |
| **gc**                 | tombstone GC bounded + safe                          | `pruneTombstones(grace)` keeps growth bounded; sweep idempotent; sweep vs edit deletes nothing live; no resurrection within grace                                                                                       |
| **undo**               | cross-doc undo: mechanism engine, granularity domain | `ActionHistory` net structural diffs (node-stable); cascade inverse via before/after snapshot diff; undo applies inverse forward → cross-doc transparent; domain `begin/end` folds reconcile so undo lands domain-valid |

### What the testing surfaced (real bugs caught, not assumed)

The **differential method earned its keep** — it caught three cascade bugs and
one GC gap that code review would not have:

1. **Orphaned canonical**: naively deleting a tree node orphaned entities whose
   _canonical occurrence_ was nested in the removed subtree. Fixed by a cascade
   that hard-deletes any node whose canonical is swept up.
2. **Infinite recursion on self-nesting**: a recursive cascade looped forever
   when a node referenced itself. Replaced with a **bounded worklist** cascade
   (the `removed` set bounds it) mirroring lode's `removeOccurrenceOrHardDelete`.
3. **Incomplete one-round cascade**: deleting a node's occurrence missed orphaned
   children of its _other_ occurrences. The worklist re-enqueues orphaned
   children and, when an occurrence is canonical, every occurrence of that node.
4. **Concurrent reference + delete** (A3): a reference to `X` created while `X`
   is deleted elsewhere leaves an occurrence pointing at a tombstoned node.
   `sweepTombstones` (GC to a fixpoint, run after sync) removes it.

## Benefit — does sharding actually deliver?

Correctness alone does not justify a migration. `bench/run.ts` (standalone; one
child process per workload so the WASM-backed CRDT's unreturned arena does not
contaminate RSS) measures the win — recorded in
[bench/bench-results.md](./bench/bench-results.md), guarded by
`bench/bench.test.ts`:

- **Smaller structure.** treeDoc snapshot is a stable **~0.35×** of the full
  single-doc at every N (62 B/node vs ~170 B/node). A treeDoc-only (lazy) engine
  holds structure for ~free at scale — RSS vanishes below the noise floor while
  the full doc holds ~11 KB/node.
- **Faster cold start.** Importing a treeDoc-only snapshot is **~0.26×** of the
  full snapshot (2.3 ms vs 8.7 ms at 50k). Structure is available immediately;
  content streams in per shard.
- **On-demand content.** Touching ONE shard costs **~0.18×** of eagerly loading
  all 64 (4 ms vs 23 ms). A view pays only for the shards it reads.
- **Partial sync.** A peer wanting one shard's edits receives a **188 B** delta,
  not the **2442 B** whole-doc update. (The sharded _sum_ is larger — per-shard
  metadata ×64 — the cost traded for per-shard delivery granularity.)
- **Affordable GC.** `sweepTombstones` over 5k nodes ≈ **23 ms** (0.025 ms/delete).

> **Caveat — the 0.35× is measured on a SIMPLIFIED treeDoc.** The prototype's
> treeDoc holds only nodeId + ownership + tombstones. Production's
> `createOccurrenceRecord` stamps every occurrence with `props` AND `meta` LoroMaps
> (managed-child state: `managedKind` + a `managedBySchemas` object array), which
> live in the treeDoc. Re-measured against that real shape
> ([bench/run-rich.ts](./bench/run-rich.ts) → [bench/rich-results.md](./bench/rich-results.md)):
> treeDoc/full is **≈0.46** (realistic, 30% managed) to **≈0.53** (worst case) —
> occurrence props+meta roughly **double** the treeDoc byte cost. The lazy-load win
> still holds structurally (treeDoc omits entity _content_, the unbounded
> dimension), but it is materially smaller than the 0.35 headline implied.

Run it:

```bash
node --import tsx --expose-gc --max-old-space-size=4096 \
     experiments/multi-shard-tree/bench/run.ts            # writes bench-results.md
```

## Scale & delivery (Tier 2)

The correctness suites run on tiny trees (algorithms are scale-invariant). Tier 2
answers the orthogonal questions — does it hold up at production scale, survive
messy delivery, and keep tombstones bounded? Scenarios run one-per-fresh-child
process (the WASM-backed CRDT does not return its arena after free, so many large
docs in one process accumulate until they abort). Recorded in
[bench/scale-results.md](./bench/scale-results.md):

- **Scale.** 10k-node single replica builds + validates + snapshots; **2×10k
  divergent replicas** `syncAll` → converge + invariant-valid (20k live nodes);
  high reference density (500 nodes × 1000 transclusions/replica) converges; a
  **1000-op partition** reconnects and converges.
- **Complexity.** Build and snapshot slope is asserted **linear** (≈29× and ≈36×
  for 50× nodes, well under the 2.5×-of-linear tolerance). **Finding:** bulk
  `hardDelete` is **O(deletes·N)** — each delete re-scans the whole tree (no
  nodeId→occurrence index); per-delete goes 8µs→612µs from 1k→50k. A production
  engine adds the index to make it O(deletes). Sweep stays sub-second at 50k.
- **Delivery chaos.** nodeId collision (two replicas `createNode` the same id →
  one node, union of occurrences), concurrent tombstone, a shard arriving late,
  out-of-order/paged delivery, duplicate delivery, VV-lost snapshot re-sync, and
  multi-client different shard subsets — **all converge** (CRDT commutativity).
- **GC.** `pruneTombstones(grace)` drops tombstones older than `grace` sync-rounds
  → growth stays **bounded** (~3 rounds retained, not the full delete history);
  sweep is idempotent; sweeping while a replica edits an unrelated live node
  deletes nothing live; a tombstone blocks a lagging replica from resurrecting a
  deleted node (no resurrection within grace).
  > **Refined by follow-up:** the tombstone is NOT what prevents resurrection.
  > `sweepTombstones` keys orphan removal off `!existsNode` (ownership), not the
  > tombstone; the real invariant is the permanence of `ownership.delete` (a Loro
  > CRDT op) + the ownership-based sweep. Verified by `test/gc-partition.test.ts`:
  > a replica partitioned **past** grace, reconnecting **after** the tombstone was
  > pruned, still does NOT resurrect the node. So the "grace must exceed the
  > worst-case partition" caveat is over-conservative under randomUUID nodeIds —
  > the tombstone's only actual reader is `createNode` (the undo↔GC bookkeeping).

```bash
node --import tsx --expose-gc --max-old-space-size=4096 \
     experiments/multi-shard-tree/bench/scale.ts             # writes scale-results.md
```

## Cross-doc undo (Tier 3 #8 — feasibility verified)

The hardest-looking gap was undo/redo across the split docs. The verified design
is **two-layer**, mirroring Anytype's `core/block/undo` (mechanism in the
structural layer, granularity decided higher up):

- **Mechanism → engine (`src/history.ts`, business-agnostic).** An `ActionHistory`
  holds a stack of actions; each action is a NET structural change recorded as
  **node-stable descriptors** (parents expressed as nodeIds, resolved to
  occurrences at apply time — so they survive the occ-id churn that delete/recreate
  causes). Undo applies the inverse **forward through OutlineApi**, so treeDoc +
  shards are written together → cross-doc is transparent (no per-doc
  `UndoManager` coordination). A cascading delete's inverse is a RESTORE-LIST
  computed by diffing the engine snapshot before vs after the op, in tree order.
- **Granularity → domain.** A composite op (e.g. `reconcile`) wraps its mutations
  in `begin/end`, so the group's net diff is recorded as ONE undo step. This
  makes the history a chain of **domain-valid** states; undo lands valid WITHOUT a
  post-undo reconcile (which would be unsound — it can negate the undo, since
  reconcile is deterministic and would re-fire on the restored state).

Proven by `test/history.test.ts` (15 tests): every primitive round-trips with
invariants held; **cascade inversion restores nodes + transclusions + content
across shards**; grouped reconcile undo lands domain-valid; the **negation**
(standalone reconcile, undone, lands domain-INVALID) shows why grouping is
required; linear undo/redo + redo-clearing + multi-cycle consistency; and
**cooperative multi-replica undo** (inverse syncs forward, converges). Also
closed: **undo↔GC contract** (#8d — `createNode` clears the stale tombstone a
delete set, so undoing a delete leaves consistent metadata and no resurrection
clash) and **rich-text undo** (#8a — content inverses capture/restore the full
delta, so marks survive undo instead of collapsing to plain text).

Remaining (production hardening): parent = canonical-occurrence (transcluded-
parent undo is a noted limitation), cross-doc transaction atomicity (the #9
durability path covers crash recovery), and multibyte coordinate care in
`applyContentDelta`.

### Canonical is mutable (#4 follow-up — promote now modeled)

Production's `promoteCanonicalOccurrence` re-points canonical to an existing
occurrence. The prototype assumed set-once; `setCanonicalOccurrence` is now in
`OutlineApi` + both engines + `ActionHistory`, and `test/promote.test.ts` (6
tests) verifies cascade correctness + undo after a promote. **This surfaced a
real latent bug:** `diffToRestore` (the cascade-undo inverse) emitted
`createReference`s in DFS order interleaved with `createNode`s; a reference that
precedes the promoted canonical in DFS was recreated before the node's entity
existed → threw. Promote makes this reachable (canonical can land at any DFS
position). Fixed with a **two-pass** restore (all `createNode`s tree-ordered,
then all `createReference`s tree-ordered). The same bug existed pre-promote
whenever a node's canonical was not DFS-first; promote merely exposed it.

### Independent audit (follow-up) — four more non-obvious gaps closed

A read-only audit + verification pass surfaced four gaps that survive code review.
All addressed (the suite is 121 tests):

1. **Cycle-forming moves fatally abort (🔴, but NOT sharding-specific).** LoroTree's
   `move` throws `Movable Tree Error: Cycle move` on a cycle-forming move; the error
   is catchable synchronously but ALSO delivered as an uncaught exception that kills
   a long-running host (daemon/vitest) — verified. Both engines now **pre-check** and
   reject a local cycle with a clean `Error` before touching Loro
   (`test/move-cycle.test.ts`, 9 tests). **Reframe:** the single-doc oracle
   (production `LoroBlockStore` shape) has the identical behavior, so this is a
   pre-existing Loro limitation the migration _inherits_, not one it introduces — it
   does not block the go/no-go. Residual: two individually-valid moves that form a
   cycle only on merge live inside Loro's import and cannot be engine-guarded.
2. **`move` had no independent truth and no multi-replica coverage.** The differential
   fuzzer refuses to emit cycle-forming moves, and the exhaustive 2-replica×1-op matrix
   omitted `move` entirely. Added leaf-only move ops to the matrix (49 pairs) + explicit
   concurrent reparenting / move-vs-delete convergence tests (`test/e-convergence.test.ts`
   E5b). Move convergence is genuine (verified).
3. **Per-occurrence `meta` was unmodeled.** Production stamps a `meta` LoroMap on every
   occurrence (managed-child provenance: `managedKind` + a `managedBySchemas` array
   carrying an occurrence id), living in the treeDoc. The prototype didn't model it, so
   it could not validate that sharding preserves occurrence-level relationship data.
   Both engines now stamp occurrence meta (production-faithful) + expose it;
   `test/occurrence-meta.test.ts` (5 tests) proves it syncs across replicas, is
   per-occurrence, and survives moves (occurrence ids are move-stable).
4. **`reconcileDurability` / `sweepTombstones` are destructive if run mid-sync.** Both
   look pure/safe (they remove things "not there") but "not there YET" ≠ "never
   existed": reconcile before shard re-sync drops a node a healthy peer still owns, and
   the drop then syncs out. Pinned as a characterization test (`test/e-durability.test.ts`)
   so a future quiescence guard / ack-aware reconcile is noticed.

### Model-level restructuring (M1) — retiring a family, not a bug

A second audit climbed above individual bugs to the prototype's load-bearing
**modeling assumptions**. The highest-leverage was M1: the equivalence relation
`canonicalStructure` (the lens EVERY differential/convergence claim is filtered
through) **hand-picked fields** — it compared plain `text` (mark-stripped), `props`,
occurrence _count_, and DFS shape, and **omitted** occurrence `meta` (managed-child
provenance) and rich-text **marks**. While the lens discarded those, two engines could
silently disagree on exactly the product-observable state that matters and the suite
would report green — an unbounded family of "silent-equivalence divergence" bugs.

Closed at the model level (not by adding a per-field test):

- `canonicalStructure` now compares the **exhaustive** observable surface: DFS shape,
  per-DFS-position occurrence `meta`, and per-node **rich delta** (marks preserved) —
  every field the `TreeSnapshot` type declares. The snapshot itself was widened to carry
  occurrence `meta` and rich `delta`.
- The fuzzer (`generateScript`) was broadened to **emit** `setOccurrenceMeta` /
  `markText` / `insertText`, so the now-compared fields are actually exercised (before,
  the fuzzer only emitted plain-text ops, so comparing marks/meta would have been inert).
- E4 (1600 differential cases) and E5 (300 multi-replica cases) now validate
  equivalence + convergence over the **full** surface (rich text + provenance), and pass.

Net: "sharded ≡ oracle" is no longer a claim about a curated subset of state, and the
fuzzer is no longer bounded to the engine's plain-text self-image. One restructuring
retired the whole silent-divergence family. (Remaining model-level assumptions the
audit named but did NOT close here — Loro-as-black-box characterization, the toy domain,
partial-state contract, workspace boundaries — are tracked as the next leverage points.)

### numShards decision — data-backed and reversible

The last "before migration" choice. Two decisions, both settled:

**1. Virtual-bucket design makes numShards reversible (not permanent).** `ownership`
now stores a node's permanent BUCKET (`hash mod P`, `VIRTUAL_BUCKETS = P = 4096`),
not the shardId. The bucket→shard grouping (`shardIdOfBucket`) is a function of the
CURRENT numShards, so raising numShards later = regrouping buckets into more shard
docs (power-of-two split-doubling: S→2S splits each shard cleanly in two by bucket),
never re-hashing a node. Pinned by `test/reshard.test.ts` (bucket stability, contiguous
grouping, the split-refinement property). This demotes numShards from "irreversible
bet" to "adjustable later, at the cost of one entity migration."

**2. Initial numShards is data-backed** (`bench/run-shard-sizing.ts` → `bench/shard-sizing-results.md`):

| S    | storage overhead (S × C_fixed) | cold-start (50-node view)                         |
| ---- | ------------------------------ | ------------------------------------------------- |
| 64   | 0.13%                          | 0.76× eager (poor — view touches half the shards) |
| 256  | 0.54%                          | 0.43× eager                                       |
| 1024 | 2.16%                          | 0.09× eager (best)                                |

`C_fixed` (an empty shard doc) is only **141 B** — far below the ~1 KB guess — so
storage is NOT the constraint (even S=1024 is ~2% of content). Cold-start locality
IMPROVES with S (smaller shards → less wasted content per view touch). The real cost
of high S is sync: each edited batch produces one delta per touched shard doc.

**Initial numShards = 256** (power-of-two; 0.43× cold-start; 0.54% storage; ~73 sync
deltas per 100-edit batch — all reasonable), with P=4096 leaving 4 split-doublings of
headroom (256→512→1024→2048→4096). Reversible: measure the real workload after
migration, split-double if cold-start dominates.

### Honest limitations of this prototype

- **Mid-sync is not atomic.** With some shards not yet synced, full
  `validateInvariants` can fail (genuinely incomplete); the contract there is
  "no crash, no corruption, self-heals on full sync" (E3), not "fully valid."
- The `remove`/`hard-delete` cascade is the **worklist** form; for tiny trees it
  is now checked against an **independent brute-force spec** (`cascade-exhaustive`),
  but deep pathological nestings at scale are not formally model-checked.
- **GC is sweep-on-sync**, not background; orphan entities persist until the next
  `sweepTombstones`. Acceptable for a prototype; a real engine would sweep on a
  schedule.
- **Durability reconcile is local.** `reconcileDurability` safely drops a
  create-direction orphan only when no replica still owns that node. The recovery
  protocol is therefore **re-sync shards before reconcile** — if a healthy
  replica still has the node, re-sync heals it; reconciling first would propagate
  a destructive drop. A future cross-replica-ack-aware reconcile could remove
  this ordering constraint.
- **Bulk delete is O(deletes·N).** Each `hardDelete` re-scans the whole tree
  (`getNodes()`) with no nodeId→occurrence index. Fine for interactive deletes;
  a batch-delete path or the index is needed for production-scale bulk deletes.
  (Surfaced and recorded by the complexity scenario — see scale-results.md.)
- **High fan-out under one parent is pathological.** Many thousand occurrences
  nested under a single parent stresses Loro's tree + snapshot; realistic
  outliners distribute children, so this is a stress limit, not a test target.

## Files

```
src/
  types.ts            OutlineApi contract + observable snapshot types
  invariant.ts        validateSnapshot — the engine's structural invariants
  single-doc-engine.ts  the oracle (one LoroDoc: occurrenceTree + entities)
  sharded-engine.ts   the engine under test (treeDoc + shards + ownership + tombstones)
  simulator.ts        multi-replica sync post-office (twoWaySync, syncReplicas, cloneReplica)
  driver.ts           op-script model (index-based refs), seeded valid-script generator
  compare.ts          topology-normalized canonicalStructure + assertEquivalent
  domain.ts           domain reconcile (schema field de-dup) + protection policy
  history.ts          engine-layer ActionHistory (undo/redo, node-stable diffs, cascade restore)
test/
  smoke.test.ts            toolchain
  oracle.test.ts           reference engine (12)
  e-differential.test.ts   E4 (4)
  e-convergence.test.ts    E5 (3)
  e-engine.test.ts         E1/E3/E6/E7/E9/E10 (10)
  d-domain.test.ts         D1–D7 (8)
  a-adversarial.test.ts    A1–A7 + exhaustive (8)
  e-durability.test.ts     #9 crash recovery: reconcileDurability (5)
  cascade-exhaustive.test.ts  #4 independent cascade truth vs brute force (4)
  d-invariants.test.ts     #4 domain invariants over fuzz (4)
  scale.test.ts            #2 10k+ build/converge + linear complexity (6)
  chaos.test.ts            #3/#10 delivery chaos converges (8)
  gc.test.ts               #6 bounded tombstone GC, no resurrection (5)
  gc-partition.test.ts     partition>grace + tombstone-necessity (4)
  history.test.ts          #8 cross-doc undo: mechanism + grouping + multi-replica (10)
  promote.test.ts          #4 canonical promote: cascade + undo (6)
  move-cycle.test.ts       cycle-move guard: clean reject vs fatal abort (9)
  occurrence-meta.test.ts  per-occurrence meta syncs + survives moves (5)
  reshard.test.ts          virtual-bucket numShards reversibility (5)
bench/
  run.ts                   standalone big-N sizing → bench-results.md
  run-rich.ts              standalone real-schema treeDoc sizing → rich-results.md
  run-shard-sizing.ts      standalone numShards tradeoff → shard-sizing-results.md
  bench.test.ts            regression: snapshot ratio + cold-load (2)
  scale.ts                 standalone Tier-2 scale matrix → scale-results.md
```

## Conclusion

The multi-shard single-tree engine is **viable**: a sharded engine that exposes
one always-structurally-correct tree, with cross-doc referential integrity,
convergence, lazy-load transparency, tombstone-coordinated GC, and a domain
reconcile layer — all proven correct by **differential equivalence against a
known-correct single-doc oracle** plus engine/domain/adversarial/exhaustive
coverage. The headline guarantee — _concurrent schema-add yields exactly one
field_ — holds.
