# Results

Date: 2026-07-29

Commands:

```sh
npm run test:proposal-authority
npm run benchmark:proposal-authority
npm run benchmark:proposal-retention
```

The behavioral suite passes all nine tests. Both candidates can express the required operation
surface, deterministic Origin and Review, support closure, transclusion and self-reference,
offline Resolution convergence, restart, full rebuild, versioned fact evolution, and safe
checkpoint compaction.

## Measurements

| Candidate    |  Nodes |  Facts | Startup ms | Full Review ms | Incremental µs/fact | Storage MiB | gzip MiB | Compacted MiB | Compacted startup ms | Loro sync 500 KiB | Heap MiB | Durable writes/fact |
| ------------ | -----: | -----: | ---------: | -------------: | ------------------: | ----------: | -------: | ------------: | -------------------: | ----------------: | -------: | ------------------: |
| fact-first   |  1,000 |  4,100 |       8.26 |           1.18 |                1.28 |        0.82 |     0.04 |          0.57 |                 6.07 |             34.07 |     6.48 |                1.00 |
| state-review |  1,000 |  4,100 |       9.97 |           0.80 |                1.11 |        1.39 |     0.08 |          0.57 |                 4.41 |             67.52 |     2.07 |                1.98 |
| fact-first   | 10,000 | 41,000 |      83.37 |           9.86 |                2.05 |        8.30 |     0.43 |          5.86 |                63.65 |             34.02 |    64.14 |                1.00 |
| state-review | 10,000 | 41,000 |      99.07 |           9.56 |                1.13 |       14.16 |     0.80 |          5.86 |                55.22 |             67.32 |    41.75 |                1.98 |
| fact-first   | 20,000 | 82,000 |     163.31 |          20.51 |                1.69 |       16.72 |     0.86 |         11.81 |               141.64 |             33.99 |    79.37 |                1.00 |
| state-review | 20,000 | 82,000 |     211.20 |          26.49 |                1.14 |       28.53 |     1.60 |         11.81 |               116.51 |             67.20 |    93.52 |                1.98 |

Environment: Node v26.4.0, Linux x64.

The uncompacted fact-first model starts 18–23% faster at 10,000 and 20,000 Nodes, stores about 41%
less uncompressed data, emits about half the Loro sync bytes for the measured tail, and performs one
durable write per input fact rather than 1.98. Both compact to the same checkpoint size because a
terminal, causally stable fact history need not be retained forever.

State-plus-review applies ordinary Direct changes about 0.5–0.9 microseconds faster in this
prototype. That result comes from eagerly updating one Origin cache while fact-first updates both
Origin and Review caches. The reverse compacted-startup and some heap results have the same cause:
the fact-first prototype eagerly materializes two views. Lazy Review activation or per-owner
incremental indexes can change those values without changing authority. They are implementation
choices, not an inherent state-authority advantage.

## Cost of retaining all facts

The following measurement keeps the visible workspace fixed at 5,000 Nodes. Increasing
`Edits/Node` adds historical overwrites of one property without increasing the number of current
Nodes, Occurrences, text values, or properties.

| Edits/Node |   Facts | Retained MiB | gzip MiB | Startup ms | Full Review ms | Checkpoint MiB | Checkpoint gzip MiB | Checkpoint startup ms | Retained heap MiB |
| ---------: | ------: | -----------: | -------: | ---------: | -------------: | -------------: | ------------------: | --------------------: | ----------------: |
|          0 |  20,000 |         4.04 |     0.20 |      45.80 |           4.36 |           2.85 |                0.16 |                 31.76 |             12.94 |
|         10 |  70,000 |        13.70 |     0.64 |     149.26 |          17.22 |           2.87 |                0.16 |                 38.07 |             39.69 |
|         50 | 270,000 |        52.88 |     2.39 |     559.55 |          64.77 |           2.88 |                0.16 |                 30.55 |            137.48 |
|        100 | 520,000 |       101.90 |     4.58 |   1,039.43 |         124.24 |           2.88 |                0.16 |                 43.00 |            252.34 |

The additional 500,000 obsolete-but-retained facts add 97.86 MiB to the durable JSON, 4.38 MiB
after gzip, about 239 MiB of retained heap, roughly one second of restart, and 120 ms to a complete
Review rebuild. The checkpoint remains about 2.88 MiB because current state is nearly unchanged.
Observed uncompressed storage grows by about 200 bytes per retained fact and runtime heap by roughly
0.5 KiB per fact in this deliberately simple in-memory implementation.

Compression makes archive and transport bytes much smaller for repetitive changes, but it does not
remove parse, indexing, version-decoding, or projection work after loading. Existing replicas sync
only the new tail, so normal incremental synchronization does not repeatedly pay for all history.
New replicas, disaster recovery, full verification, history migration, and any projection rebuild
must process the retained history unless they are allowed to trust a checkpoint.

## Correctness boundary

The state-plus-review candidate is complete only when the Origin state and live facts are jointly
authoritative. A one-shot Accept patch is insufficient. If a later offline Reject wins, the system
must repair the earlier materialization without overwriting later Direct work. That requires the
Proposal fact, competing Resolution facts, every Direct fact relevant to the affected support
closure, a checkpoint predating those facts, and an idempotent materialization marker. The
experiment demonstrates the repair, including restart between durable Resolution and Origin update.

Consequently, the complete state-plus-review design cannot obtain its apparent advantage by
discarding the semantic fact model. While review is live, it adds a second authority surface,
double-writes Direct changes, duplicates sync traffic, and owns a cross-store saga. If it omits
those costs, it fails the tested offline Resolution-flip scenario. These costs are structural, not
migration debt in the prototype.

Fact-first authority has no corresponding cross-store consistency boundary. Contribution and
Resolution facts are the single durable input, while Origin, Review, indexes, and materialized
workspace shards are replaceable projections. Restart and resolution flips use the same projection
path as ordinary operation. Its new obligations are versioned fact semantics, incremental
projection indexes, and a checkpoint protocol.

Schema evolution does not distinguish the candidates as strongly as it first appears. Fact-first
must preserve the historical meaning of every uncompacted fact through a versioned operation
decoder or a checkpoint created under the old rules. State-plus-review needs the same mechanism for
every still-live Proposal and retained Direct support fact. Replaying old facts under whichever
rules happen to be current is invalid for both.

Compaction is also a shared local-first constraint. Neither candidate can delete a terminal
Proposal or Resolution merely because the local replica has handled it. Safe reclamation requires a
causal-stability frontier, and permanently absent replicas require an explicit membership eviction
or checkpoint-generation rule. Without that external fact, both must retain enough information to
prevent resurrection.

## Decision supported by the spike

The evidence eliminates state-plus-review as the preferred terminal authority model when migration
compatibility is excluded. It can satisfy the product semantics, but only by retaining the same
semantic facts needed by fact-first authority and then adding materialized-state authority,
dual-stream synchronization, idempotent repair, and crash ordering. Its small incremental-write
advantage is a cache strategy that fact-first can adopt without the second authority surface.

The recommended terminal model is therefore **checkpointed fact-first authority**: versioned
Contribution and Resolution facts are authoritative within the live horizon; Origin and Review use
one deterministic, domain-owned Reconcile graph; persistent checkpoints and materialized shards
bound startup and history cost after causal stability; indexes and projections are rebuildable.
This is not permanent, audit-oriented event sourcing. History beyond the safe checkpoint frontier
is not a product requirement and should be compacted.

No unresolved product-value trade-off remains between these two authority models. The next design
decision must specify the unified domain identities, fact vocabulary, activation and support
invariants, and Reconcile contract around checkpointed fact-first authority. Persistence format,
membership-aware compaction, migration, and production sharding remain later design work.

## Subsequent retention decision

The initial product strategy is to retain every Contribution and Resolution fact while starting
from a checkpoint plus its uncovered tail. The checkpoint records the covered fact frontier and
rule/schema version, remains rebuildable from the complete fact history, and does not authorize
deleting covered facts. Safe causal-stability compaction remains a demonstrated future option rather
than an MVP requirement. This trades growing replica, backup, cold-start transfer, and migration
volume for simpler offline merge, complete history, and no immediate membership-eviction or
generation-rejection protocol.

Fact-first authority does not replace the CRDT substrate. The production FactStore is expected to
reuse Loro and the existing `SyncableDoc`, `DocStore`, and `SyncExchange` mechanisms for durable
snapshots, version-vector updates, idempotent merge, mutation push, and periodic anti-entropy.
Domain Reconcile consumes a storage-neutral immutable fact set and causal coordinates rather than
Loro container types; that boundary keeps domain rules testable without creating a second
replication implementation.
