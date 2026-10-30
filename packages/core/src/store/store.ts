// Purpose: Provides workspace storage access to the document and its ownership and holder indexes.

import { LoroDoc } from "loro-crdt";
import { HolderIndex } from "./holder-index.ts";
import type { NodeId } from "./node-id.ts";
import { Ownership } from "./ownership.ts";
import { configureText } from "./text.ts";

const TREE = "nodes";

/**
 * One workspace document as storage: the Loro document and its derived indexes. Only `store/` knows
 * how the model's facts are encoded as tree positions, root containers and map keys. The tree records
 * ownership only; a node's facts, name and listing are root containers keyed by its NodeId, which
 * every incarnation shares.
 */
export class Store {
  readonly doc: LoroDoc;
  readonly ownership: Ownership;
  readonly holders: HolderIndex;

  constructor(doc: LoroDoc) {
    this.doc = doc;
    this.ownership = new Ownership(doc, doc.getTree(TREE));
    this.holders = new HolderIndex(this, doc);
  }

  /** A document with text styles configured, as every replica must have before it reads or writes. */
  static newDoc(): LoroDoc {
    const doc = new LoroDoc();
    configureText(doc);
    return doc;
  }

  /** Allocated: some tree node carries the id. Says nothing about presence. */
  has(id: NodeId): boolean {
    return this.ownership.has(id);
  }
}
