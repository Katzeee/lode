# Proposal Reconcile scheduler spike

This experiment compares scheduling models for the fact-first Proposal Mode authority chosen by the
preceding authority-model spike. It does not implement production Reconcile. It asks which
scheduling contract can preserve one deterministic set of domain rules while supporting both full
rebuild and incremental projection maintenance.

The executable model uses a real `loro-crdt` document as the FactStore and a storage-neutral
`FactSnapshot` containing immutable Contribution and Resolution facts, a causal `FactFrontier`, and
typed mutations. The same rules derive Origin and Review.

The candidates are:

- `phase-dag`, which runs a statically validated owner DAG in full on every invocation;
- `global-worklist`, which repeatedly evaluates a deterministic global worklist to a fixed point;
- `owner-dataflow`, which uses the same statically validated owner DAG but advances only owners
  invalidated by the fact tail. Semantic Support Dependency closure remains a bounded,
  owner-local convergence step.

Run the behavioral evidence with:

```sh
npm run test:proposal-reconcile-scheduler
```

Run the scale measurement with:

```sh
npm run benchmark:proposal-reconcile-scheduler
```

[TEST-MODEL.md](TEST-MODEL.md) records the model, claims, and limits.
[RESULTS.md](RESULTS.md) records the evidence and the scheduling contract selected by the spike.
