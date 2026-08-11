# Results

Date: 2026-07-25

Command:

```sh
npm run test:proposal-routing
```

Environment: repository `loro-crdt` 1.11.x and the current `packages/engine` source.

## Evidence

### Rule-composed Reconcile

- A tested rule contract requires every rule to declare its domain owner, input keys, output keys,
  ordering dependencies, and implementation.
- One rule graph derives both Origin and Review; only the activation input differs.
- Registration order and fact-arrival order do not change the result.
- The graph rejects missing rule dependencies, dependency cycles, undeclared outputs, and duplicate
  producers instead of allowing accidental coupling.
- Node existence and structural support are separate policies. The same structural reference
  produces a support edge under cascade removal but not under rehome policy, demonstrating that
  dependencies come from domain counterfactuals rather than references alone.
- A new `tag` operation was added by registering one domain-owned rule without changing the
  scheduler or existing rules.
- Same-workspace, full-overlay, and fact-first Loro record placement all fed the same rule graph and
  produced the same projection. Storage placement can therefore remain outside domain rules.

### Same-document text

- Loro rich-text attributes can mark current Proposal spans and support an Origin projection that
  filters them.
- A Direct insertion inside a Proposal-marked span inherits the Proposal attribute even with
  `expand: "none"`. The Direct editor must explicitly clear that attribution on its inserted range.
- After it does so, “pre-existing `年度` between Proposal additions” and “Direct `年度` inserted
  later between Proposal additions” have the **same** final Loro delta. Current Proposal attributes
  therefore cannot recover the histories needed for different Hunk-bridge behavior; that UX
  requires additional insertion-source/interleaving facts.
- Deleting only the captured Proposal-attributed characters preserves interleaved Direct text and a
  concurrently-created later Proposal after real Loro synchronization.
- Loro text-style configuration is replica-local configuration, not synchronized document state;
  every client must configure attribution styles consistently.

### Overlay

- A real Loro fork can hold Proposal edits, import concurrent accepted-base drift, and converge.
  Concurrent ordering is deterministic for a fixed set of peers but not a product-selected order;
  the experiment observed both legal placements of a concurrent `!` across runs with random peer
  ids.
- Importing the same overlay update twice is idempotent.
- Raw CRDT update bytes are not a partial-Accept primitive. Importing an overlay update containing
  `p1` and `p2` materializes both. Accepting only `p1` requires product-level semantic
  materialization while `p2` remains in the overlay.
- A cross-document Accept survives a crash only when the resolution is durable before
  materialization and the accepted document records a stable materialization id. Retrying with that
  id is idempotent.

### Domain operations

- The real Engine deterministically replays create, Direct edit of a newly-created Node, move,
  Occurrence deletion, and property modification when facts target stable Node identity and
  permanent occurrence identity.
- Semantic children are physically stored once under the Canonical Occurrence and returned from
  every reference Occurrence, confirming that repeated child display is a UI projection.
- A fixed inverse is not a valid general Same-doc Reject: `Proposal blue→green`, later
  `Direct →red`, then replaying the stored inverse `→blue` destroys the Direct value. Reject must be
  derived from current facts with the Proposal excluded and executed through current domain rules.

## Conclusions supported by the tests

1. **Both physical placements are mechanically possible, but neither works as a raw CRDT trick.**
   Both require stable Proposal contributions, resolution facts, dependency-aware Reconcile, and
   typed domain materialization.
2. **Overlay does not remove the unified contribution model.** It needs that model and additionally
   pays for cross-document identity, composed reads, a durable Accept saga, idempotency, retry, and
   temporary document skew.
3. **Same-doc cannot be “mark some current state and replay inverse ops.”** Attribution must be
   maintained explicitly, and Reject must be recomputed from current facts rather than replaying a
   historical inverse.
4. **The rule kernel should be chosen before physical placement.** Domain rules need not know
   whether facts came from the content document, an overlay, or a fact sidecar.
5. **Source/interleaving information is a separate product choice.** If pre-existing Origin text
   must split Hunks while later Direct interleaving bridges them, ordinary Proposal attribution is
   insufficient and additional replicated facts are required.

## Candidate comparison after the rule experiment

### Attributed Same-doc state

Pending edits live in the current content state with attribution. This avoids a second review store
but forces Origin subtraction, explicit attribution on every editor path, fact retention, and
current-state Reject. It does not remove the Reconcile kernel.

### Full workspace Overlay/fork

Accepted state stays clean, but raw fork updates cannot partial-Accept and the route duplicates a
workspace-shaped state that still needs semantic facts. It adds cross-document anchors and an
Accept saga without eliminating domain Reconcile. The evidence does not favor this variant.

### Review Fact Sidecar

The existing Engine remains the Origin authority. A replicated workspace-owned review doc stores
semantic Proposal facts, Resolution facts, and the Direct contribution facts still needed for live
attribution or dependency closure—not a second workspace image. Direct and Proposal use the same
operation vocabulary and rules; Direct commands materialize into Origin immediately, while Proposal
commands remain pending facts until Accept. One rule graph derives Review over the current Origin;
Accept materializes typed domain commands with a stable idempotency fact. This keeps rules
storage-neutral, avoids attributed pending operations in the hot content state, and avoids
pretending raw overlay bytes are product patches. It still pays the tested cross-document
Accept/retry boundary and needs a retention rule for relevant Direct facts.

### Fully fact-first dual projection

All Direct and Proposal edits are authoritative facts; Origin and Review are both projections and
the Engine becomes a materialized cache. This is conceptually cleanest but has the largest migration
and unproven incremental projection, retention, and compaction cost.

The current experiment does **not** establish a preferred final architecture. Review Fact Sidecar
fits the tested rule boundary and the current state-oriented Engine, but that advantage may only be
an advantage in migration cost. Migration compatibility is not a selection criterion for the final
design. Fully fact-first/event-sourced authority must be spiked as a first-class destination—not
treated as a possible future evolution—before selecting between it and any state-plus-sidecar
design.

The next spike must compare complete final architectures by capability and long-term design quality.
At minimum it must prove full domain-operation coverage, deterministic and incremental Origin/Review
projection, offline conflict and resolution behavior, restart and full rebuild, idempotent
materialization, rule and schema evolution, and safe snapshot/compaction semantics. It must also
measure startup, incremental update, storage, memory, and synchronization costs at representative
workspace sizes. A route is selectable only after it meets the required behavior and its remaining
complexity is shown to be intrinsic rather than compatibility debt.

## Not proven

- Production integration with the current sharded Engine.
- Fine-grained text commands in the current protocol; ordinary editing still uses full-text
  replacement.
- Compaction/garbage-collection safety for contribution and resolution facts.
- Every offline race among competing Accept/Reject facts.
- Fixed-point interaction among rules that cannot be expressed as an acyclic phase graph.
- Whether a fully fact-first/event-sourced Engine is operationally viable at representative scale.
- Whether Review Fact Sidecar has any lasting architectural advantage once migration cost is
  excluded.

These are specification and implementation follow-ups, not facts established by this experiment.
