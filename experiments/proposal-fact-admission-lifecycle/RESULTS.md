# Results

The spike resolves the ambiguity between ordinary offline incompleteness and invalid authority.
Offline delivery may leave causal gaps, so a replica durably retains well-formed records while
admitting only the maximum validated causal prefix. A gap is pending, not corruption, and does not
advance the logical Fact Frontier. When the missing predecessor arrives, admission and projection
repair deterministically. A receipt-only Loro update likewise changes the physical document without
claiming domain progress.

An invalid digest, conflicting content for one Fact ID, impossible causal coordinate, observed
terminal Resolution, or invalid Restore is different: it establishes an Authority Fault. The
workspace keeps its last complete published Projection readable, rejects new writes, and publishes
no later generation rather than silently dropping the record or interpreting a different history.
Recovery is explicit; it is not part of ordinary offline synchronization.

New state-dependent commands plan only against a complete Projection Generation whose frontier
equals the admitted durable Fact Frontier. A lagging projection may be awaited; if it cannot catch
up, the command returns a pre-commit typed unavailable result. It does not plan against stale state.
An already-recorded Invocation remains queryable and retryable during lag.

Invocation identity is the pair of Invocation ID and canonical request digest. Repeating both
returns the original receipt; reusing an Invocation ID for different input is a conflict. The local
application contract therefore includes an outcome query for recovery after a response is lost.

Replica identity and sequence are scoped to a Workspace, and a Fact ID names its Format Generation,
Workspace, Replica, and sequence. Peer/device identity remains separate. Semantic Support
Dependencies are derived from versioned typed mutations and owner policy instead of accepting an
independent, unverifiable dependency list in each Contribution.

Concurrent opposite Resolutions select the greatest Fact in the existing neutral causal order.
Accept/Reject values do not influence ordering. A Resolution that observes an earlier Resolution
for the same Contribution is invalid rather than an override.

Lifecycle compensation uses explicit Node and Occurrence Restore mutations. Restore references an
observed delete Fact and re-enables the same stable identity; Create never resurrects an old
identity. A global Node delete continues to suppress Occurrences delivered later from an offline
replica. Restore can re-enable them, while another uncompensated concurrent delete makes selective
Undo stale rather than allowing it to overwrite that deletion.

The tests use real Loro documents, the existing `DocStore` port, the SQLite-backed
`WorkspaceStore`, staged durable-before-adopt writes, restart, and two-replica merge. They prove the
contract is mechanically coherent, not that the experimental implementation is production code.
