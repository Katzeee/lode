// Purpose: Resolves a projected address to the current copy materialized for it, or to the projection itself.

import { isPresent } from "../graph/presence.ts";
import type { Graph } from "../graph/graph.ts";
import { allocatedGenerations } from "../store/derived-id.ts";
import type { NodeId } from "../store/node-id.ts";
import { copyId, isProjected, type NodeAddress } from "./address.ts";

/**
 * What an address reads now. A NodeId is itself, even once its node has retired from a role: a
 * reference keeps naming the node it names. A projection resolves its instance, source and root first,
 * then reads the newest generation of its copy id that is current, so a projected address held from
 * before a materialization, a nested address, and a reference inside a projection all read the copy.
 * With no current copy it stays the projection. Reading never allocates, and a copy is found by its
 * id only, never guessed from a source.
 */
export function resolveAddress(graph: Graph, address: NodeAddress): NodeAddress {
  if (!isProjected(address)) {
    return address;
  }
  const resolved = {
    instance: resolveAddress(graph, address.instance),
    root: resolveAddress(graph, address.root),
    source: resolveAddress(graph, address.source),
    mode: address.mode,
  };
  const { instance } = resolved;
  if (isProjected(instance)) {
    // Copies are made outer context first, so an instance with no copy holds none.
    return resolved;
  }
  const copies = allocatedGenerations(graph.store, copyId(resolved));
  for (let index = copies.length - 1; index >= 0; index--) {
    if (isCurrentCopy(graph, copies[index]!, instance)) {
      return copies[index]!;
    }
  }
  return resolved;
}

/**
 * A copy binds its projection while it is present and stays inside its instance's ownership. Undoing
 * its creation, deleting it to Trash, moving it out of the instance or releasing its owner retires it,
 * and the slot shows the template again, as in the reference system; undoing that rebinds it. Editing,
 * reordering or referencing it elsewhere does not.
 */
function isCurrentCopy(graph: Graph, copy: NodeId, instance: NodeId): boolean {
  const owner = graph.store.ownership.physicalOwner(copy);
  return isPresent(graph, copy) && owner !== undefined && graph.store.ownership.ownsOrIs(instance, owner);
}
