// Purpose: Deletes a node from a parent: an original goes to the top of Trash, a reference only loses that occurrence.

import { ownerOf } from "../graph/presence.ts";
import type { NodeId } from "../store/node-id.ts";
import { canDelete } from "./guards.ts";
import { removeChild, removesChild } from "./listing.ts";
import { moveToTrash } from "./owner.ts";
import type { Writer } from "./writer.ts";

/**
 * When `parent` owns `node`, the node moves to the top of Trash, its owned subtree with it; then the
 * parent removes it as removing a child does, so a tuple's last value leaves an empty one. Otherwise
 * only the occurrence is removed. Owner and listing are all that change: relations, name, kind and
 * presence stay, so a deleted holder stays associated. Refused from Trash and from a system node, and
 * for Home's own listing; the structural nodes are otherwise protected where their position would
 * change, so deleting the root's Schema writes nothing while a reference to Schema is deleted.
 */
export function deleteMe(writer: Writer, node: NodeId, parent: NodeId): void {
  const { graph } = writer;
  if (!canDelete(graph, node, parent)) {
    return;
  }
  // The parent is written before the node leaves it, so that losing its last support to the move
  // into Trash does not skip removing the occurrence.
  if (removesChild(graph, parent, node)) {
    writer.touch(parent);
  }
  if (ownerOf(graph, node) === parent) {
    moveToTrash(writer, node);
  }
  removeChild(writer, parent, node);
}
