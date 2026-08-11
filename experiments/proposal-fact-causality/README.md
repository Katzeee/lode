# Proposal fact mutation and causality spike

This production-shaped spike closes the gap between the earlier simplified authority experiments
and the production Fact contract. It exercises an append-only authority log and derived rich-text,
tree, and map projections with the repository's installed Loro 1.13.6 rather than treating a plain
array or string model as sufficient evidence.

Run it with:

```sh
npm run test:proposal-fact-causality
```

The executable model establishes five boundaries. Domain facts use their own replica sequence,
observed FactFrontier, and validated Lamport rank; Loro VersionVector and Frontiers remain physical
sync coordinates and may advance for invocation receipts without advancing the logical frontier.
Authority records live in an append-only LoroList, so a concurrent same-FactId/different-content
write remains visible and fails closed instead of being hidden by map LWW. Rich-text deletion and
formatting address explicit stable atom identities, while insertion and structural placement use
two-sided identity anchors with deterministic affinity and fallback. Reconcile orders validated
facts causally, uses replica identity only as a neutral concurrent tie-break, and replays affected
owners so checkpoint plus tail produces the same result as a full rebuild.

The mutation union is intentionally a domain algebra rather than a copy of Engine commands. One
Contribution contains one independently resolvable primitive mutation. A command may emit several
Contributions and connect them with semantic support dependencies. Field and schema commands lower
to node, occurrence, text, canonical-occurrence, and addressed value mutations rather than adding a
second mutation system.

Loro cursors remain useful inside a live materialized projection, but they are not durable domain
coordinates: they identify operations in that projection's Loro history, which a discarded and
rebuilt projection is not required to preserve. The durable text coordinate is therefore the
storage-neutral TextAtomId derived from Contribution identity and Unicode-scalar offset. UI UTF-16
positions are resolved to atom identities against the command's observed projection before the Fact
batch is committed.
