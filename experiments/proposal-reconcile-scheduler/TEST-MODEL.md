# Test model

## Decision under test

The spike decides the scheduling contract for deterministic Origin and Review projections over
checkpointed fact-first authority. It does not reconsider the authority model, FactStore topology,
Loro synchronization, or the ownership boundaries already fixed by the Proposal Mode map.

The alternatives differ only in scheduling. They consume the same sorted `FactSnapshot`, execute
the same pure rules, and produce the same normalized `Projection`. This prevents a candidate from
appearing faster or simpler by omitting domain behavior.

## Production-shaped boundary

`LoroFactStore` stores facts by stable `FactId` in a Loro map. Identical appends are idempotent and
conflicting payloads for one identity fail closed. A snapshot exposes immutable Contribution and
Resolution facts plus a per-replica `FactFrontier`; none of the schedulers consumes a Loro container
directly.

Contribution facts preserve Direct or Proposal intent, a causal coordinate, observed frontier,
typed mutation, and Semantic Support Dependency identities. Resolution facts preserve Accept or
Reject, a captured set of Proposal Contribution identities, and a causal coordinate. Concurrent
opposite decisions use a neutral deterministic order.

The projection surface includes Node presence, rich text and marks, properties, schemas and managed
children, Occurrences, canonical Occurrences, moves, cascade and rehome deletion, transclusion, and
self-reference-safe semantic rendering.

## Candidate mechanics

`phase-dag` validates one producer for every output, all declared dependencies, and an acyclic
owner graph, then evaluates every rule once in deterministic topological order. Semantic Support
Dependency closure is a finite contracting calculation inside the review owner.

`global-worklist` retains the unique-output checks but repeatedly visits the global rule set until
no output changes. The test implementation uses canonical structural comparison so registration
order cannot affect the answer. The global iteration cap is a fail-closed termination guard.

`owner-dataflow` uses the validated DAG and the same local support closure as `phase-dag`. A
checkpoint persists source frontier, rule/schema version, source facts, and owner outputs. A tail
invalidates the review activation index and the domain owners its fact shapes can affect;
Resolution facts and explicit support changes invalidate all materializers conservatively.

## Correctness evidence

The behavior suite requires all candidates to produce identical Origin and Review for every
mutation kind. It exercises rich-text marks, properties, schema-managed children, create/delete/
move, cascade/rehome, transclusion and semantic self-reference, a Direct Contribution supported by
a pending Proposal, and Accept/Reject.

It imports concurrent Loro snapshots in both directions and requires convergence after an offline
Accept/Reject race. It reverses fact arrival and rule registration order, persists and hydrates a
checkpoint before applying a shuffled tail, repeats facts, and delivers a dependent before its
support.

Composition tests require missing dependencies, duplicate cross-owner outputs, illegal graph
cycles, invalid text ranges, and stored Occurrence cycles to fail closed. An added audit owner may
write its declared output without changing any existing projection output.

The owner-dataflow test also proves that a local text append evaluates only review activation,
text, and final assembly. A Resolution remains deliberately broad because it can change an
arbitrary support closure.

## Benchmark

The default benchmark builds 2,000 Nodes and 8,600 base facts in a real Loro document. It then
applies 100 individual property facts, a 200-fact text tail, and 100 Resolution facts, finishing at
9,000 facts. Startup measures Origin plus Review rebuild. Full rebuild measures final Origin.
Tail replay reports the cost per fact for the 200-fact batch; Direct append reports the median of
100 individual appends. The benchmark also records Resolution-batch latency, encoded checkpoint
size, isolated retained heap, and the number of owner evaluations for the last Direct append.

Retained heap is measured in a fresh child process for each candidate by holding ten projection
results live across a forced collection and dividing the delta. It is directional rather than a
production capacity estimate.

## Limits

The prototype uses whole-snapshot activation and simple in-memory indexes. It does not implement
production sharding, fine-grained Loro rich-text operations, incremental graph reachability,
checkpoint trust/verification, schema migration, crash recovery, or SyncExchange. Its absolute
times are not service-level objectives.

Canonical JSON comparison makes the worklist candidate especially conservative. Part of that
candidate's measured cost is an unoptimized prototype mechanism; repeated global waves and a
global termination obligation are nevertheless inherent to an unrestricted global fixed point.

All candidates persist the same intentionally complete rule cache, so checkpoint size does not
measure a candidate advantage. A production checkpoint may encode indexes and projections more
compactly without changing the selected scheduling contract.
