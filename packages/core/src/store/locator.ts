// Purpose: Maintains the NodeId → incarnations index and picks each NodeId's canonical incarnation.

import type { LoroDoc, LoroTree, LoroTreeNode, TreeID } from "loro-crdt";
import type { NodeId } from "./node-id.ts";

const ID = "id";

/** The NodeId a tree node carries: the only value a tree node's own map holds. */
export function idOf(node: LoroTreeNode): NodeId | undefined {
  return node.data.get(ID) as NodeId | undefined;
}

export function writeId(node: LoroTreeNode, id: NodeId): void {
  node.data.set(ID, id);
}

/**
 * The deterministic order of incarnations: peer, then counter, both numeric. A TreeID is
 * `<counter>@<peer>`; comparing the strings would order peer 10 before peer 9.
 */
export function compareTreeIds(a: TreeID, b: TreeID): number {
  const [counterA, peerA] = a.split("@") as [string, string];
  const [counterB, peerB] = b.split("@") as [string, string];
  const peers = BigInt(peerA) - BigInt(peerB);
  return peers === 0n ? Number(counterA) - Number(counterB) : peers < 0n ? -1 : 1;
}

/**
 * Maps each NodeId to every tree node carrying it, built on open and kept current from the document's
 * tree events, so a lookup never scans the tree. Replicas that create one derived NodeId concurrently
 * each create a tree node for it, an incarnation; the smallest TreeID is canonical on every replica.
 * Nodes are never deleted from the tree, so incarnations only accumulate.
 */
export class Locator {
  readonly #tree: LoroTree;
  readonly #byId = new Map<NodeId, TreeID[]>();

  constructor(doc: LoroDoc, tree: LoroTree) {
    this.#tree = tree;
    for (const node of tree.getNodes()) {
      this.index(node);
    }
    doc.subscribe((batch) => {
      for (const event of batch.events) {
        if (event.diff.type === "tree") {
          for (const item of event.diff.diff) {
            if (item.action === "create") {
              this.#indexTreeId(item.target);
            }
          }
        } else if (event.diff.type === "map" && "id" in event.diff.updated && event.path[0] === "nodes") {
          // A node's id arrives in the map event that follows its tree event.
          const treeId = event.path[1];
          if (typeof treeId === "string") {
            this.#indexTreeId(treeId as TreeID);
          }
        }
      }
    });
  }

  has(id: NodeId): boolean {
    return this.#byId.has(id);
  }

  /** Every incarnation, canonical first. */
  incarnations(id: NodeId): LoroTreeNode[] {
    return (this.#byId.get(id) ?? []).flatMap((treeId) => this.#tree.getNodeByID(treeId) ?? []);
  }

  isCanonical(node: LoroTreeNode, id: NodeId): boolean {
    return this.#byId.get(id)?.[0] === node.id;
  }

  ids(): IterableIterator<NodeId> {
    return this.#byId.keys();
  }

  /** Indexes a tree node now, so a node created in an open transaction is found before it commits. */
  index(node: LoroTreeNode): void {
    const id = idOf(node);
    if (id === undefined) {
      return;
    }
    const treeIds = this.#byId.get(id) ?? [];
    if (!treeIds.includes(node.id)) {
      treeIds.push(node.id);
      treeIds.sort(compareTreeIds);
      this.#byId.set(id, treeIds);
    }
  }

  #indexTreeId(treeId: TreeID): void {
    const node = this.#tree.getNodeByID(treeId);
    if (node) {
      this.index(node);
    }
  }
}
