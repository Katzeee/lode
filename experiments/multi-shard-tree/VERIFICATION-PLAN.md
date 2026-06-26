# Remaining verification plan — Tier 1 & 2

This is a **handoff spec** for the verification work that remains after the
initial 45-test suite (see [README.md](./README.md)). It is self-contained:
another machine (or session) should be able to execute it without further
context. **Tier 3 (partial-sync product semantics, resharding, full content
model / undo-across-docs) is explicitly deferred** — not in this document.

## Status

**Done & pushed** (`experiment/multi-shard-tree`): the design, the single-doc
oracle, the multi-shard engine, the sync simulator, domain reconcile, and
45 tests covering E1–E10, D1–D7, A1–A7, exhaustive. Differential equivalence
(sharded ≡ oracle) is proven.

**Tier 1 now closed** (60 tests, 11 files, all green; numbers in
[bench/bench-results.md](./bench/bench-results.md)):

- **#1 Benefit proven.** `bench/run.ts` (standalone, child-process-per-workload
  for clean WASM RSS) + `bench/bench.test.ts` (regression). treeDoc/full snapshot
  ratio ≈ **0.35** at every N; treeDoc-only cold load ≈ **0.26×** of full;
  touching one shard costs ≈ **0.18×** of eager-all-64; per-shard sync delta
  (188 B) vs whole-doc update (2442 B); sweep 5k ≈ 23 ms.
- **#4 Independent truth.** `test/cascade-exhaustive.test.ts` — every tiny
  tree × transclusion pattern × every remove/hardDelete matches a brute-force
  fixpoint spec (not the engine's worklist). `test/d-invariants.test.ts` —
  domain invariants (≤1 slot/field, no stale) hold over 200 fuzz seeds,
  idempotent + order-independent.
- **#9 Durability.** `ShardedEngine.reconcileDurability()` + `test/e-durability.test.ts`
  — create-direction and delete-direction crash orphans reconcile to an
  invariant-valid fixpoint; converges with a healthy replica. **Recovery
  protocol:** re-sync shards BEFORE reconcile when a replica may still own a
  crashed-create node (reconcile-then-sync would propagate a destructive drop).

**Tier 2 now closed** (79 tests, 14 files, all green; numbers in
[bench/scale-results.md](./bench/scale-results.md)):

- **#2 Scale + complexity.** `bench/scale.ts` (one workload per fresh child
  process) + `test/scale.test.ts`. 10k single-replica build+validate+snapshot;
  2×10k divergent replicas `syncAll` → converge + invariant-valid; high reference
  density; 1000-op partition → reconnect → converge. **Complexity:** build &
  snapshot slope asserted linear (≈29× / ≈36× at 50× nodes, tolerance 2.5×).
  **Finding:** bulk `hardDelete` is O(deletes·N) (no nodeId→occurrence index) —
  recorded; a production engine adds the index. Sweep stays sub-second at 50k.
- **#3 + #10 Chaos at the sync layer.** `simulator.ts` chaos primitives
  (`syncTreeOnly`, `syncReplicasPartial`) + `test/chaos.test.ts`. nodeId
  collision → one node + union of occurrences; concurrent tombstone; missing
  shard arrives later; out-of-order/paged delivery; duplicate delivery; VV-lost
  snapshot re-sync; multi-client different shard subsets — all converge.
- **#6 GC / tombstone long-term.** `ShardedEngine.advanceRound()` +
  `pruneTombstones(grace)` + `test/gc.test.ts`. Tombstone growth bounded (≈3
  rounds retained, not the full history); sweep idempotent; sweep vs concurrent
  edit deletes nothing live; no resurrection within grace (tombstone blocks a
  lagging replica).

**Remaining (Tier 3 — deferred until the design is in production):** #5
partial-sync product semantics, #7 resharding, and #8's production hardening.
**#8's mechanism is now verified feasible** (`src/history.ts` +
`test/history.test.ts`, 15 tests): a two-layer undo (mechanism in the engine,
granularity in the domain) makes cross-doc undo transparent and lands undo on
domain-valid states via grouping. **#8a (rich-text undo — marks survive via
delta capture/restore) and #8d (undo↔GC contract — `createNode` clears the stale
tombstone a delete set) are also closed.** See the #8 section at the bottom.

## Measured baselines (already collected — use these, don't re-derive)

Per-node cost, loro-crdt v1.11.0, ~20-char content, wide tree (one doc at a time):

| doc shape                                       | in-process (RSS)   | serialized snapshot |
| ----------------------------------------------- | ------------------ | ------------------- |
| **full** (tree + entities/content)              | **~10–12 KB/node** | ~170 B/node         |
| **treeDoc** (structure + ownership, no content) | **~1.2 KB/node**   | ~58 B/node          |

- **treeDoc saves ~89% in-process, ~66% serialized** vs full — the lazy-load win
  is real and structural.
- **Deep-tree ceiling ≈ 1000–2000 depth**: Loro's `LoroTreeNodeFinalization`
  raises an **uncatchable `RuntimeError: memory access out of bounds`** in WASM
  at that depth (a finalizer use-after-free in loro-crdt v1.11.0). This is **not
  RAM-fixable and not catchable** — it aborts the process. Real outliner nesting
  (hundreds) is safe; treat >~1k depth as a documented limitation, not a test
  target.

## Resource budget

- **8 GB free RAM** is sufficient for everything below at realistic scale
  (wide sizing to 100k; multi-replica fuzz to ~50k nodes/replica; long-history GC).
- **16 GB** needed only for **multi-replica runs holding 100k nodes/replica
  simultaneously** (5 × 1.2 GB ≈ 6 GB with no headroom on 8 GB).
- Deep tests: capped at ~1k depth regardless of RAM (Loro bug above).

## Hard rules (follow on any machine)

1. **One workload at a time.** Never hold many large docs in one process — that
   is what froze the previous machine. Build → measure → release (`doc.free?.()`
   - null) before the next.
2. **Heavy / large-N / multi-replica measurements run as a standalone `node`
   child process** with `--expose-gc`, `--max-old-space-size=<budget>`, and a
   `timeout` wrapper — so a runaway or the deep-tree abort dies alone and does
   not take the OS with it.
3. **No deep tree beyond ~1000 depth in any automated suite.** Document the
   ceiling; do not try to "test through" it.
4. Snapshot **bytes** are exact and comparable across runs; **RSS** needs forced
   gc (`--expose-gc` + `globalThis.gc()`) for clean numbers.

---

## Tier 1

### #1 Performance benchmarks — `bench/` ✅ DONE

**Goal:** prove sharding actually delivers (the prototype proved correctness,
not benefit). Two artifacts (built; numbers in
[bench/bench-results.md](./bench/bench-results.md)):

- **`bench/run.ts`** — standalone, `node --import tsx --expose-gc`, one workload
  per fresh **child process** (loro-crdt is WASM-backed and does not return its
  arena after free, so in-process RSS deltas are contaminated), writes
  `bench/bench-results.md`. It imports the real `SingleDocEngine`/`ShardedEngine`
  (the lazy-read measurement needs the real `shardLoader` path; "raw loro" alone
  could not model it). Covers the big-N numbers:
  - Wide sizing, full vs treeDoc, `N ∈ {1k,10k,50k,100k}`: build time, RSS delta,
    snapshot bytes, per-node. Report **treeDoc/full ratio** (snapshot + RSS).
  - Cold load: time to `import` a full snapshot vs a treeDoc-only snapshot.
  - Lazy read: treeDoc-only `ShardedEngine` + `shardLoader` (already added — see
    `ShardedEngine` constructor 3rd param), read 200 random nodes' content
    (triggers on-demand shard load); compare to a fully-loaded single doc.
  - Sync update bytes: edit 100 of 2000 nodes; single-doc `exportUpdateFrom`
    bytes vs sharded sum of per-doc deltas.
  - Sweep cost: delete 1000 of 5000, time `sweepTombstones`.
- **`bench/bench.test.ts`** — vitest, **always in the suite**, small N (≤10k),
  asserts the core properties so they can't silently regress:
  - treeDoc/full snapshot ratio `< 0.5` at N ≥ 10k.
  - cold treeDoc-only load time `< cold full load time.
  - (Re-add `"bench/**/*.test.ts"` to `vitest.config.ts` `include`.)

**Acceptance:** treeDoc is materially smaller and faster to cold-load than the
full single-doc at scale; numbers recorded in `bench-results.md`.

### #9 Multi-doc durability — `src/sharded-engine.ts` + `test/e-durability.test.ts` ✅ DONE

**Goal:** close the create-direction atomicity hole. `createNode` writes the
treeDoc (occurrence + ownership) and the shard (entity) in two steps; a crash
between them leaves an occurrence whose entity is missing. (`sweepTombstones`
only covers the delete direction.)

- Add `ShardedEngine.reconcileDurability()`: on restart, scan live occurrences;
  for any whose entity is missing (ownership present, shard entity absent),
  drop the occurrence + ownership entry (the content was never written, so the
  node is incomplete and safe to discard). Symmetric: finish a half-applied
  hard-delete (occurrence/tombstone gone but entity still present → delete it).
- Tests (`e-durability.test.ts`):
  - Crash after treeDoc write, before shard write → `reconcileDurability()` →
    orphan occurrence removed, invariants hold.
  - Crash after hardDelete's treeDoc step, before shard entity delete →
    reconcile finishes the delete; invariants hold.
  - Crash mid-cascade → reconcile reaches a valid fixpoint.
  - After any crash + reconcile, state converges with a non-crashed replica.

**Acceptance:** any single-step crash + `reconcileDurability()` yields an
invariant-valid state that converges with a healthy replica.

### #4 Independent invariants + exhaustive cascade model — `src/invariant.ts` + `test/` ✅ DONE

**Goal:** differential proved _transparency_ (sharded ≡ oracle), not _truth_ —
both engines share the cascade/reconcile semantics, so a shared bug is invisible
to differential. Add checks that do **not** derive from the implementation.

- **Domain invariants** (new, in `invariant.ts` or `domain.ts`), asserted over
  random op+reconcile sequences:
  - Every schema field is realized by **≤ 1** slot.
  - Every slot's `fieldDef` is in the schema's `fields`.
  - `reconcileSchema` is idempotent (run twice → same state) and a pure function
    of state.
- **Exhaustive cascade spec** (`test/cascade-exhaustive.test.ts`): for every
  tiny tree shape (3–4 nodes, with and without references/transclusion),
  enumerate every remove/hard-delete operation and assert the worklist cascade's
  result equals a **brute-force independent spec**:
  > a node is live iff it has ≥1 live occurrence; removing a canonical occurrence
  > kills the node and all its occurrences; removing a non-canonical occurrence
  > removes only that occurrence's subtree; an occurrence whose node was deleted
  > is removed (the sweep truth).
  > This is the independent truth the differential oracle cannot provide.

**Acceptance:** domain invariants hold under fuzz; the cascade matches the
brute-force spec on all enumerated tiny-tree delete patterns.

---

## Tier 2

### #2 Larger-scale fuzz + complexity — `src/driver.ts` + `test/scale.test.ts` ✅ DONE

**Goal:** confidence at realistic scale and a complexity argument against
algorithmic blowup.

- Add generators: **deep** (chain, depth ≤ ~1k — respect the Loro ceiling),
  **wide** (star), **high reference density** (many `createReference`).
- Tests (`scale.test.ts`), each in its own process or with release-between:
  - 10k-node single replica: build + `validateInvariants` + snapshot.
  - Multi-replica (≤50k/replica on 8 GB; 100k on 16 GB): long divergent scripts
    → `syncAll` → converge + invariant-valid.
  - High reference density: many transclusions → converge + invariants.
  - Long partition: many ops offline → reconnect → converge.
  - **Complexity sanity:** measure snapshot / cascade / sweep time at
    `N ∈ {1k,5k,10k,50k}`; assert the slope is roughly linear (no hidden O(n²)).

**Acceptance:** convergence + invariants at 10k+; measured time grows ~linearly.

### #3 + #10 Chaos harness at the sync layer — `src/simulator.ts` + `test/chaos.test.ts` ✅ DONE

**Goal:** the current simulator is an idealized full two-way exchange. Real sync
has delivery chaos. Move adversarial coverage from the op layer to the delivery
layer.

- Extend the post-office (`simulator.ts`) with per-doc options: **drop**,
  **delay**, **duplicate**, **partial-shard delivery**, **VV-persistence-failure
  (re-sync from snapshot)**, and **multi-client with different loaded shard sets**.
- Tests (`chaos.test.ts`):
  - Convergence under random drop/delay/dup with **eventual** delivery.
  - Missing shard arrives later → self-heals.
  - Concurrent tombstone (two replicas delete the same node) → converge, node
    gone on both.
  - **nodeId collision** (two replicas `createNode` the same nodeId) → converge
    deterministically (LWW on the entity key; occurrence set is the union).
  - Out-of-order / paged shard delivery → converge.
  - VV lost → re-sync from snapshot → converge.
  - Multi-client different shard subsets → converge.

**Acceptance:** all scenarios converge to one invariant-valid state.

### #6 GC / tombstone long-term — `src/sharded-engine.ts` + `test/gc.test.ts` ✅ DONE

**Goal:** tombstones currently accumulate unbounded (set on every hardDelete,
never cleaned). Prove bounded, safe long-term behavior.

- Add a tombstone cleanup policy to `sweepTombstones` (or a new method). Without
  cross-replica acks the simplest safe policy is **time/round-based**: a tombstone
  may be dropped once the deleted nodeId is no longer referenced by any live
  occurrence **and** a grace number of sync rounds has passed (so a lagging
  replica that still has the node live won't resurrect it). Document the chosen
  policy.
- Tests (`gc.test.ts`):
  - Tombstone set size stays bounded over a long delete+sync sequence (assert a
    ceiling, not monotonic growth).
  - Sweep is **resumable**: interrupt mid-fixpoint, resume → same result.
  - **Concurrent sweep vs user edit:** sweeping while a replica edits unrelated
    live nodes deletes nothing live.
  - **No resurrection:** old-tombstone cleanup never brings a deleted node back
    or orphans a live one.

**Acceptance:** tombstone growth bounded; no resurrection; no wrong deletes.

---

## Out of scope (Tier 3 — deferred until the design is in production)

- **#5 partial-sync product semantics:** what the UI does during content-pending
  (read missing content, edit pending entity, whether reconcile/GC fires on
  incomplete state). A product decision before a test gap.
- **#7 resharding:** changing `numShards`, shard migration, hot shards. Note:
  the immutable-ownership design makes resharding harder (entities must move);
  mitigate by choosing a generous fixed `numShards` (e.g. 64–256) up front.
- **#8 full content model — undo mechanism VERIFIED feasible.** The hard-looking
  part — undo/redo **across docs** — is proven solvable by `src/history.ts` +
  `test/history.test.ts` (15 tests): a two-layer design (mechanism in the engine
  as a node-stable `ActionHistory` that applies inverses forward through
  `OutlineApi` → cross-doc transparent; granularity in the domain via
  `begin/end` grouping so reconcile folds into one undo step and undo lands
  domain-valid without an unsound post-undo reconcile). **#8a done** (rich-text:
  content inverses capture/restore the full delta → marks survive undo) and
  **#8d done** (undo↔GC: `createNode` clears the stale tombstone a delete set →
  no resurrection clash). Remaining: entity/occurrence meta, cross-doc
  transaction atomicity (the #9 durability path covers crash-mid-transaction),
  transcluded-parent undo.

## How to run (on the target machine)

```bash
# from the lode repo root:
node_modules/.bin/vitest run --root experiments/multi-shard-tree   # the suite (incl. bench.test.ts)
node --import tsx --expose-gc --max-old-space-size=4096 \
     experiments/multi-shard-tree/bench/run.ts                     # the big-N sizing evidence (standalone)
```
