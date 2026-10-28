// Purpose: Defines how a node shown through a template is addressed and identified without a stored copy.

import type { NodeId } from "../store/node-id.ts";

/**
 * `template` shows a template node as it is; `emptyField` shows a template field with one system empty
 * value instead of its default.
 */
export type ProjectionMode = "template" | "emptyField";

/**
 * A template node shown in an instance's context with no stored copy. `root` is the top-level template
 * child the projection started from; it bounds which of the source's relations stay projected. The
 * instance, the root and the source may themselves be projected, which nests contexts: a template
 * reached through a projection is shown through that projection.
 */
export type Projected = {
  readonly instance: NodeAddress;
  readonly root: NodeAddress;
  readonly source: NodeAddress;
  readonly mode: ProjectionMode;
};

export type NodeAddress = NodeId | Projected;

export function isProjected(address: NodeAddress): address is Projected {
  return typeof address !== "string";
}

/**
 * The identity of an address. A stored node is its id, so an id still compares equal to a plain name
 * holding the same text. A projected node is identified by its instance, its source and, in
 * empty-field mode, the field it started from, encoded structurally so nesting stays unambiguous:
 * a projection of a projection never shares an identity with a projection through a projection. Two
 * instances of one template show two different nodes; the root is a boundary, not part of the
 * identity in template mode.
 */
export function addressKey(address: NodeAddress): string {
  if (!isProjected(address)) {
    return address;
  }
  const parts = [addressKey(address.instance), addressKey(address.source)];
  if (address.mode === "emptyField") {
    parts.push(addressKey(address.root));
  }
  // The leading NUL keeps a projected identity out of the space of stored ids.
  return `\u0000${JSON.stringify(parts)}`;
}

export function sameAddress(a: NodeAddress | undefined, b: NodeAddress | undefined): boolean {
  return a !== undefined && b !== undefined && addressKey(a) === addressKey(b);
}

/** The stored node a projection ultimately shows. */
export function storedNode(address: NodeAddress): NodeId {
  return isProjected(address) ? storedNode(address.source) : address;
}
