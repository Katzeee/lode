# Results

Date: 2026-07-30

Commands:

```sh
npm run test:proposal-reconcile-scheduler
npm run benchmark:proposal-reconcile-scheduler
```

The behavioral suite passes all ten tests. The three candidates produce identical normalized
Origin and Review projections across the complete test surface, converge after Loro replica merge,
remain deterministic under shuffled registration and arrival, and keep persisted checkpoint plus
tail equivalent to full rebuild. Invalid composition and invalid domain state fail closed.

## Measurements

| Candidate       | Nodes | Facts | Startup ms | Full rebuild ms | Tail replay µs/fact | Direct append µs | Resolution ms | Checkpoint MiB | Heap MiB | Direct evals |
| --------------- | ----: | ----: | ---------: | --------------: | ------------------: | ---------------: | ------------: | -------------: | -------: | -----------: |
| phase-dag       | 2,000 | 9,000 |      12.86 |            4.52 |               41.69 |         4,843.43 |          6.01 |           5.24 |     1.40 |            7 |
| global-worklist | 2,000 | 9,000 |     244.24 |          124.02 |              637.09 |       164,122.63 |        126.80 |           5.24 |     3.30 |           28 |
| owner-dataflow  | 2,000 | 9,000 |       7.45 |            3.75 |               19.88 |         4,009.91 |          5.47 |           5.24 |     2.59 |            3 |

Environment: Node v26.4.0, Linux 7.1.3 x86_64.

Startup includes both Origin and Review. Tail replay is a 200-fact text batch. Direct append is the
median of 100 one-fact property advances. Resolution is a 100-fact batch. Heap is an isolated,
forced-GC directional measurement and should not be read as a production capacity estimate.

## Interpretation

The unrestricted global worklist provides no semantic benefit for the tested domain graph. It
evaluates 28 rules for one Direct append, versus seven for full DAG execution and three for
owner-dataflow. In this implementation it is about 19 times slower than owner-dataflow at startup,
41 times slower for an individual Direct append, and 23 times slower for the Resolution batch.
Canonical structural comparison exaggerates the absolute gap, but the repeated global waves,
global convergence proof, and coarse invalidation are structural liabilities.

`phase-dag` gives the simplest rebuild and termination argument. Every cross-owner edge is known
before execution, and every rule runs once. Its weakness is not correctness but incremental cost:
an unrelated property or text fact still reevaluates all owners.

`owner-dataflow` preserves the DAG's composition and termination properties while avoiding
unaffected owners. It cuts the measured 200-fact tail cost by about 52% and the individual Direct
append by about 17% relative to full DAG execution. A text append evaluates review activation,
text, and final assembly only. The Resolution advantage is smaller because the prototype
conservatively invalidates every owner when a decision may change support closure.

All candidates encode the same 5.24 MiB checkpoint because they retain the same source facts and
owner outputs. Heap values are the same order of magnitude; the spike does not support choosing a
scheduler for memory reasons.

The remaining roughly 4 ms Direct-append cost in `owner-dataflow` is dominated by rescanning the
whole fact set for activation and support closure. That is a prototype implementation limit, not a
reason to choose global iteration. Production should give the review owner incremental
Contribution, latest-Resolution, reverse-support, and active-closure indexes while preserving the
same external rule contract.

## Decision

Select a **statically validated owner-dataflow DAG with bounded owner-local convergence**.

This is a constrained combination of the static phase DAG and incremental owner reducers, not an
unrestricted reducer network. Cross-owner dataflow must remain acyclic and single-writer.
Fixed-point behavior is permitted only inside one concept owner when that owner declares a finite
monotone measure and a hard bound. Semantic Support Dependency closure satisfies this requirement:
its candidate set only contracts and can remove each Contribution at most once.

Do not use a global worklist/fixed point as the production composition model. It makes termination,
ownership, invalidation, and performance global concerns without enabling a required scenario.

## Scheduling contract for 架构归属与接口契约

Reconcile consumes an immutable, storage-neutral `FactSnapshot`, `ViewMode`, rules version, and
schema version. It publishes a projection only when every required owner output corresponds to the
same `FactFrontier`. Loro containers, SyncExchange messages, and materializer handles do not cross
this boundary.

Each rule is owned by one domain concept and declares a stable identity, one or more uniquely owned
outputs, upstream outputs, fact-impact selectors, deterministic evaluation, and any local
convergence measure. Composition rejects missing inputs, cross-owner output collisions,
cross-owner cycles, unknown rule versions, and invalid checkpoints before evaluation.

The scheduler compiles the declarations into a deterministic topological plan. Full rebuild
evaluates that plan from authoritative facts. Incremental advance starts from a versioned
checkpoint, applies a fact tail, invalidates the directly affected owners and their declared
downstream dependents, then evaluates the resulting subgraph in the same topological order. An
unknown fact shape, support-topology change, Resolution, or invalid impact declaration falls back
to conservative downstream invalidation or full rebuild; it never silently reuses a possibly stale
output.

The review owner owns Proposal activation, latest neutral Resolution arbitration, Semantic Support
Dependency indexes, and the bounded effective-closure calculation. Node, Occurrence, Text,
Property, and Schema owners materialize only their outputs. Occurrence owns cascade/rehome and
stored-tree validity; schema owns managed-child derivation. A final assembly step may combine those
outputs but may not rewrite them.

A checkpoint records its `FactFrontier`, rule/schema versions, and owner caches. It is usable only
when those versions match and the tail descends from its frontier. Checkpoint plus tail and full
rebuild are two execution paths for the same rules and must remain property-tested for equivalence.
Any owner failure leaves the previous published projection intact and marks the target frontier for
retry or rebuild; facts are already authoritative and are never compensated because projection
maintenance failed.

This contract is sufficiently specific for 架构归属与接口契约 to place the scheduler, ports, and
materialization lifecycle without choosing production data structures prematurely.
