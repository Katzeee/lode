// Purpose: Derives the NodeIds of nodes that follow from another node, and their generations.

import type { NodeId } from "./node-id.ts";
import type { Store } from "./store.ts";

/*
 * A derived node's NodeId is computed from what it derives from, so replicas that create it
 * concurrently converge on one node instead of two. Derived ids contain no `/` or NUL, which Loro
 * root container names refuse, and no `|`, which relation keys reserve. The reference system's ids are
 * random; deriving them is Lode's mechanism for concurrent creation and changes no serial result.
 */

/** A host's metanode. */
export function metanodeId(host: NodeId): NodeId {
  return `${host}:meta` as NodeId;
}

/** A metanode's tag application. */
export function applicationId(metanode: NodeId): NodeId {
  return `${metanode}:tags` as NodeId;
}

/**
 * Generation `n` of a derived id: `base`, then `base#1`, `base#2`. A retired node keeps its identity,
 * so a new one in its role takes a new generation, as the reference system makes a new node there.
 */
export function generation(base: NodeId, n: number): NodeId {
  return (n === 0 ? base : `${base}#${n}`) as NodeId;
}

/** Every allocated generation of `base`, oldest first; they are allocated without gaps. */
export function allocatedGenerations(store: Store, base: NodeId): NodeId[] {
  const ids: NodeId[] = [];
  for (let n = 0; store.has(generation(base, n)); n++) {
    ids.push(generation(base, n));
  }
  return ids;
}

/**
 * The id a new node in `base`'s role takes: the first generation this replica has not allocated.
 * Called only when the role has no current node and an operation decides to create one; no read ever
 * allocates.
 */
export function nextDerivedId(store: Store, base: NodeId): NodeId {
  return generation(base, allocatedGenerations(store, base).length);
}
