// Purpose: Provides workspace storage access to the document, node tree and reference leaves.

import { LoroDoc, type LoroTree, type LoroTreeNode } from "loro-crdt";
import { HolderIndex } from "./holder-index.ts";
import { Locator } from "./locator.ts";
import type { NodeId } from "./node-id.ts";
import { idOf, refOf, writeRef } from "./records.ts";
import { configureText } from "./text.ts";

const TREE = "nodes";

/**
 * One workspace document as storage: the Loro document, its node tree, and its derived indexes. Only
 * `store/` knows how the model's facts are encoded as tree positions and map keys.
 */
export class Store {
  readonly doc: LoroDoc;
  readonly tree: LoroTree;
  readonly holders: HolderIndex;
  readonly #locator: Locator;

  constructor(doc: LoroDoc) {
    this.doc = doc;
    this.tree = doc.getTree(TREE);
    this.#locator = new Locator(doc, this.tree);
    this.holders = new HolderIndex(this, doc);
  }

  /** A document with text styles configured, as every replica must have before it reads or writes. */
  static newDoc(): LoroDoc {
    const doc = new LoroDoc();
    configureText(doc);
    return doc;
  }

  find(id: NodeId): LoroTreeNode | undefined {
    return this.#locator.find(id);
  }

  node(id: NodeId): LoroTreeNode {
    const node = this.find(id);
    if (!node) {
      throw new Error(`no node ${id}`);
    }
    return node;
  }
}

/** The tree parent's NodeId: the stored owner. Undefined for an ownerless node, which is a Loro root. */
export function parentIdOf(node: LoroTreeNode): NodeId | undefined {
  const parent = node.parent();
  return parent && idOf(parent);
}

/** Owned nodes and reference leaves under `node`, in their one shared order. */
export function treeChildren(node: LoroTreeNode): LoroTreeNode[] {
  return node.children() ?? [];
}

/** The reference leaves under `parent` naming `target`. */
export function leavesFor(parent: LoroTreeNode, target: NodeId): LoroTreeNode[] {
  return treeChildren(parent).filter((child) => refOf(child) === target);
}

export function createLeaf(parent: LoroTreeNode, index: number, target: NodeId): LoroTreeNode {
  const leaf = parent.createNode(index);
  writeRef(leaf, target);
  return leaf;
}

/** Leaves carry no identity, so deleting one never removes a node. */
export function deleteLeaf(store: Store, leaf: LoroTreeNode): void {
  if (idOf(leaf) !== undefined) {
    throw new Error("only reference leaves are deleted");
  }
  store.tree.delete(leaf.id);
}
