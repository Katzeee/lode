# Projection storage benchmark

## Decision

This spike decides whether persisting a Projection Generation materially improves large-Workspace
startup enough to justify the current publication cost, and whether a less granular checkpoint
layout deserves a production design pass.

The unknown is the relative elapsed time, retained memory, publication payload, and document count
of rebuilding from a loaded Fact snapshot, restoring the current materialized representation, and
restoring simpler checkpoint representations. Evidence changes the answer when it shows either
that restore is not meaningfully cheaper than rebuild at representative sizes, or that a simpler
layout preserves most of the restore benefit while avoiding a material current cost.

This spike does not decide the production format, remove bounded query reads, model Loro loading,
or establish a final Workspace size target. It deliberately starts at the `FactSnapshot` boundary,
so the authority store can change without invalidating the Projection-storage comparison. The
synthetic model isolates Projection computation and storage; it is not a product workload claim.

## Artifact

The disposable benchmark lives at
`packages/engine/tests/benchmark/projection-storage.benchmark.ts`. Run it from the repository root
with:

```powershell
node --expose-gc --import tsx packages/engine/tests/benchmark/projection-storage.benchmark.ts
```

The runner executes every measured route in a fresh process, performs explicit garbage collection
before the measured operation, takes the median elapsed-time run from three repetitions, and emits
machine-readable JSON after the human-readable table. Set `LODE_SPIKE_CHUNK_SIZE` to compare chunk
sizes; the default is 256 entries.

## Evidence

The recorded run is in [PROGRESS.md](./PROGRESS.md). The key observation is that Projection
persistence becomes useful as reconcile cost grows, but the current per-entry document format often
costs more to restore from SQLite than rebuilding the Projection. At 15,000 Nodes, rebuild takes
1.25 seconds from an already loaded Fact snapshot while current SQLite restore takes 6.32 seconds
and current publication takes 12.77 seconds. At 30,000 Nodes, an in-memory current-format restore
finally beats rebuild, but still takes 2.77 seconds and peaks roughly 707 MiB above its baseline.

A disposable 256-entry range-chunk layout retains persisted indexes, bounded pages, immutable
generation-specific chunks, and manifest-last publication. At 15,000 Nodes on SQLite it publishes
in 316 milliseconds, restores in 204 milliseconds, and reads a 100-Node page in 1.17 milliseconds.
It uses 500 documents and a 37.69 MiB database rather than the current 134,647 documents and
176.14 MiB database.

This evidence is partial rather than a final storage decision. It supports investigating Projection
checkpoints at a coarser physical granularity, but it does not yet compare the complete Fact recovery
path, direct ordered SQLite identities without a duplicate directory, checkpoint cadence plus Fact
tail replay, or reuse of unchanged materialized data between generations.

## Follow-up boundary

This experiment remains the layer-isolated evidence for Projection physical layout. It should not be
expanded into an end-to-end startup benchmark because mixing authority loading, Fact interpretation,
reconciliation, and Projection restoration would make regressions difficult to attribute. A separate
recovery benchmark compares a Fact checkpoint followed by Projection rebuild, a periodic Projection
checkpoint plus incremental catch-up, and a continuously published query materialization. That run
also isolates the cost introduced by hashing shard identities and rebuilding an ordered directory
above SQLite.

Loro now owns authoritative Facts directly as one mergeable append log per Fact replica; the former
JSON authority journal and derived Loro synchronization projection no longer exist. The container
spike measured a 45,081-Fact Loro snapshot import at roughly 135–180 milliseconds, while the current
cold interpretation pass over the same fixture takes roughly 15–18 seconds. The next recovery benchmark
therefore treats Fact loading and Fact interpretation as separate costs and must compare a cold
interpretation pass with an incremental or checkpointed interpreter before attributing startup time
to Projection reconstruction.
