// Purpose: Maintains the NodeId lookup index as local and remote document changes arrive.

import type { LoroDoc, LoroTree, LoroTreeNode, TreeID } from "loro-crdt";
import type { NodeId } from "./node-id.ts";
import { idOf } from "./records.ts";

/**
 * Maps NodeId to the tree node holding it, built on open and kept current from the document's tree
 * events, so a lookup never scans the tree. Nodes are never deleted from the tree, only reference
 * leaves are, and leaves carry no NodeId.
 */
export class Locator {
  readonly #tree: LoroTree;
  readonly #byId = new Map<NodeId, TreeID>();

  constructor(doc: LoroDoc, tree: LoroTree) {
    this.#tree = tree;
    for (const node of tree.getNodes()) {
      this.#index(node.id);
    }
    doc.subscribe((batch) => {
      for (const event of batch.events) {
        if (event.diff.type === "tree") {
          for (const item of event.diff.diff) {
            if (item.action === "create") {
              this.#index(item.target);
            }
          }
        } else if (event.diff.type === "map" && "id" in event.diff.updated) {
          // A node's id arrives in the map event that follows its tree event.
          const treeId = event.path[1];
          if (typeof treeId === "string") {
            this.#index(treeId as TreeID);
          }
        }
      }
    });
  }

  find(id: NodeId): LoroTreeNode | undefined {
    const treeId = this.#byId.get(id);
    return treeId === undefined ? undefined : this.#tree.getNodeByID(treeId);
  }

  #index(treeId: TreeID): void {
    const node = this.#tree.getNodeByID(treeId);
    const id = node && idOf(node);
    if (id !== undefined) {
      this.#byId.set(id, treeId);
    }
  }
}
