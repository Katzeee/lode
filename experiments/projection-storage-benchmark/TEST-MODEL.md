# Test model

The fixture uses the real Fact constructors and the real `rebuildGeneration`, Review read-model,
`BoundedProjectionStore`, materialized codecs, and `DocumentStore` paths. It creates a branching
tree of directly committed Nodes. Each Node contributes a creation, initial owner relation, and
Occurrence placement, so the workload grows the main Projection sections and the owner and
Occurrence reverse indexes together.

The measured routes are a rebuild from an already loaded `FactSnapshot`, publication and restoration
through the current per-entry shard plus authenticated-directory format, a monolithic generation
checkpoint, and a two-level checkpoint that groups materialized entries into ordered chunks of 256.
The candidate formats are deliberately disposable. They expose the cost curve; they do not propose
a durable schema.

The benchmark excludes Loro import time, Fact interpretation, network synchronization, and command planning.
It also excludes proposals, resolutions, Supertags, materialized Fields, and template instances.
Memory figures are operation deltas sampled at storage boundaries and completion; synchronous
intermediate allocation can exceed the reported value. Runs must therefore interpret memory as a
comparative approximation rather than an exact heap peak.

The monolithic control writes one atomically replaced checkpoint and validates every regenerated
materialized entry after decoding. It cannot serve a bounded cold page. The chunked control groups
ordered entries by dataset root, writes immutable generation-specific chunks, and publishes a
generation-specific manifest last. Its page route loads the manifest and only enough chunks to
return 100 entries. Neither control measures cleanup of an older generation.
