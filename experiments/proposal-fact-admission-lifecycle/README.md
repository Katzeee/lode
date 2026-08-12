# Proposal Fact Admission and Lifecycle Spike

This experiment closes the production-contract gap between replicated Loro records and the
storage-neutral `FactSnapshot` consumed by domain reconciliation. It is decision evidence, not a
production implementation.

The model deliberately separates four states. Loro updates become durable physical records first;
records with a causal gap remain pending; only structurally and causally valid contiguous records
enter the admitted Fact snapshot; a coherent Origin/Review generation is published separately.
`FactFrontier` describes only the admitted prefix, so receipt-only updates and pending records do
not create false domain progress.

The tests exercise a real Loro document, the existing `DocStore` port, the SQLite-backed
`WorkspaceStore`, staged durable-before-adopt commits, restart, response retry, request identity,
projection gating, missing predecessors, terminal Resolution arbitration, stable-identity
lifecycle restoration, and two-replica merge.

Run the evidence with:

```sh
npm run test:proposal-fact-admission
```
