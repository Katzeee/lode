# Test model

## Controlled comparison

Both candidates consume the same immutable, stably identified Contribution and Resolution facts.
Facts carry a deterministic Lamport-style stamp and a schema version. Direct Contributions are
active in both Origin and Review. A pending Proposal Contribution is active only in Review; Accept
also activates it in Origin, while Reject removes it from both. Concurrent resolutions use the same
deterministic last-writer rule in both candidates.

The projector covers Node creation and global deletion, text replacement, typed properties, schema
application with derived defaults, Occurrence creation, movement and deletion, stable identity,
transclusion, and self-reference. A Direct Contribution can declare Semantic Support Dependencies
on Proposal Contributions; it remains active only when its support closure is active. The test does
not replace Loro's character or tree CRDT ordering. Those mechanics were already tested against the
real library in `experiments/proposal-routing-feasibility`.

The fact-first candidate owns a durable checkpoint and a fact tail. It maintains Origin and Review
caches incrementally for ordinary Direct appends and rebuilds when a Resolution or out-of-order
support fact invalidates activation.

The state-plus-review candidate owns a durable checkpoint, a materialized Origin, and a replicated
live-fact window. Direct Contributions are written to both Origin and the live-fact window because
later rejection or a support-policy change cannot be repaired correctly from state alone. A
Resolution is durable before materialization; restart runs an idempotent repair from the checkpoint
and live facts. This is the smallest complete version of the candidate, rather than a deliberately
weak one-shot patch implementation.

## Behavioral scenarios

The nine executable tests cover all operation kinds, identical Origin and Review results, policy
support closure, transclusion and self-reference, reverse fact arrival, offline Accept/Reject
competition, a losing Accept materialization followed by later Direct editing, every durable crash
boundary of the state-plus-review saga, restart and full rebuild, schema evolution through a
versioned legacy operation, and compaction safety.

Compaction is permitted only after an external causal-stability frontier says all participating
replicas have observed the terminal Resolution for every compacted Proposal. The spike intentionally
throws when this precondition or terminality is absent. Retired Proposal identities stand in for a
production checkpoint generation or version-vector frontier, so a fact from a pre-checkpoint
generation cannot resurrect compacted review state.

Replica merge scenarios operate within one checkpoint generation. Installing a newer checkpoint on
an older replica, rejecting pre-generation updates, and transferring uncompacted tails are protocol
work for the later persistence and evolution decision; the spike establishes the information and
causal-stability preconditions that protocol must preserve.

## Scale workload

The benchmark creates synthetic 8-way outline trees at 1,000, 10,000, and 20,000 Nodes. Each Node
receives creation, one canonical Occurrence, text, and one property. Five percent of Nodes also
receive a Proposal and terminal Resolution, producing 4,100, 41,000, and 82,000 facts.

Startup parses the durable representation and opens Origin. Full Review recomputes the Review
projection. Incremental cost applies 500 Direct text changes. Storage is the prototype's
deterministic JSON encoding, with gzip reported separately. Compacted storage advances a causally
stable checkpoint and drops the settled fact tail. Sync size uses real `loro-crdt` maps to encode a
500-fact tail; the state-plus-review measurement sums its Origin and review streams. Heap
measurements run in isolated `--expose-gc` child processes.

The timings are five-sample medians on one machine and are useful for order of magnitude and
relative write-path shape, not production capacity planning. JSON representation, eager dual
projection in the fact-first prototype, absence of shard indexes, and synthetic data all affect the
absolute numbers. Durable write count and dual-stream sync amplification, by contrast, follow from
the candidate authority boundaries rather than from the benchmark language.

The retention benchmark holds the current workspace shape fixed at 5,000 Nodes, then overwrites the
same property 0, 10, 50, or 100 times per Node. Every old Direct fact is retained even though only
the last value remains visible. This isolates history length from current-state size. It reports the
durable JSON and gzip sizes, restart, full Review rebuild, retained heap, and the corresponding
causally stable checkpoint. Its timings are three-sample medians in isolated processes.
