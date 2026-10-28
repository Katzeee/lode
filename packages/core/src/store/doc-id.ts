// Purpose: Defines the workspace document identity that system node ids derive from.

import type { LoroDoc } from "loro-crdt";

/** Identifies one workspace document. Chosen when the workspace is created, before genesis. */
export type DocId = string & { readonly brand: "DocId" };

const WORKSPACE = "workspace";
const DOC_ID = "docId";

export function newDocId(): DocId {
  return crypto.randomUUID() as DocId;
}

/**
 * Kept in a document-level map rather than found from the tree: ownerless nodes are Loro roots too,
 * so the workspace root cannot be told apart by position.
 */
export function readDocId(doc: LoroDoc): DocId | undefined {
  return doc.getMap(WORKSPACE).get(DOC_ID) as DocId | undefined;
}

export function writeDocId(doc: LoroDoc, docId: DocId): void {
  doc.getMap(WORKSPACE).set(DOC_ID, docId);
}
