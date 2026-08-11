# Proposal authority-model spike

This experiment compares two complete terminal authority models for Proposal Mode without treating
compatibility with the current Engine as an advantage:

- **Fact-first authority** stores versioned Direct and Proposal Contribution facts plus Resolution
  facts as the durable write model. Origin and Review are projections over a checkpoint and the
  uncompacted fact tail.
- **State + review facts** stores a materialized Origin alongside the replicated facts still needed
  for live review. Direct editing writes both Origin and the live-fact window. Accept and later
  resolution changes run a durable, idempotent materialization repair.

Both candidates use the same deterministic operation vocabulary, ordering, support-dependency
closure, schema upcasting, and projection code. The experiment therefore varies authority topology
rather than domain behavior.

Run the behavioral evidence with:

```sh
npm run test:proposal-authority
```

Run the scale measurements with:

```sh
npm run benchmark:proposal-authority
npm run benchmark:proposal-retention
```

The test model and limits are recorded in [TEST-MODEL.md](TEST-MODEL.md). Measured results and the
architectural conclusion are in [RESULTS.md](RESULTS.md).

This is an executable architecture spike, not a production implementation. Fine-grained text CRDT
behavior and the current Engine's stable identities were exercised by the preceding
`proposal-routing-feasibility` experiment; this experiment deliberately focuses on the authority,
rebuild, compaction, and cross-store questions that remained open.
