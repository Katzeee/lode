// Purpose: Defines and generates node identities independent of storage positions.

/**
 * A node's identity. Loro tree ids are storage positions, unique only within one
 * document, so nothing outside `store/` names a node by tree id. `|` is reserved: relation keys use it
 * as a separator.
 */
export type NodeId = string & { readonly brand: "NodeId" };

export function newNodeId(): NodeId {
  return crypto.randomUUID() as NodeId;
}
