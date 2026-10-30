// Purpose: Provides workspace storage access to the document, node tree and reference leaves.

import { LoroDoc, type LoroText, type LoroTree, type LoroTreeNode } from "loro-crdt";
import { HolderIndex } from "./holder-index.ts";
import { Locator } from "./locator.ts";
import type { NodeId } from "./node-id.ts";
import { idOf } from "./records.ts";
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

  /**
   * The node's name: a root text keyed by NodeId, not a container in the node's map. A root text needs
   * no creation operation, so no two replicas race to create it, and undoing an edit to it survives
   * remote tree operations, which an undo of a text inside a locally created tree node's map does not
   * in loro-crdt 1.17.1.
   */
  name(id: NodeId): LoroText {
    return this.doc.getText(`name:${id}`);
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

/** The nodes `node` owns. Their tree order carries no meaning: listings are stored apart. */
export function treeChildren(node: LoroTreeNode): LoroTreeNode[] {
  return node.children() ?? [];
}
