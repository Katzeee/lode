// Purpose: Writes a workspace's system nodes identically on every replica, so merging yields one set.

import type { LoroDoc, LoroTreeNode } from "loro-crdt";
import { systemNodes, type SystemNodes, type SystemRole } from "../graph/system-nodes.ts";
import { nextCommandId } from "../store/command-id.ts";
import { readDocId, writeDocId, type DocId } from "../store/doc-id.ts";
import { GENESIS } from "../store/origins.ts";
import { nameOf, writeCreationFacts, writeListed, writeSupport, type Kind } from "../store/records.ts";
import { Store } from "../store/store.ts";

/** Reserved for genesis; no replica is ever leased this peer id. */
const GENESIS_PEER = 0n;

type SystemSpec = { role: SystemRole; parent?: SystemRole; listed?: boolean; kind?: Kind; name?: string };

/**
 * Fixed order and fixed ids. The containers are listed under the root; the definition roles and the
 * empty value are owned by the root but unlisted, so no outline shows them.
 */
const SPECS: readonly SystemSpec[] = [
  { role: "root" },
  { role: "home", parent: "root", listed: true, kind: "home", name: "Home" },
  { role: "trash", parent: "root", listed: true, name: "Trash" },
  { role: "schema", parent: "root", listed: true, name: "Schema" },
  { role: "supertag", parent: "root", name: "supertag" },
  { role: "fieldDefinition", parent: "root", name: "field definition" },
  { role: "options", parent: "root", name: "options" },
  { role: "tags", parent: "root", name: "supertags" },
  { role: "emptyValue", parent: "root" },
];

/**
 * Writes the system nodes as peer 0 with a fixed timestamp, so every replica of `docId` writes the
 * same bytes; each carries peer 0's support, so none can lose presence. The caller sets the replica's
 * own peer id afterwards.
 */
export function genesis(docId: DocId): LoroDoc {
  const doc = Store.newDoc();
  doc.setPeerId(GENESIS_PEER);
  const store = new Store(doc);
  const ids = systemNodes(docId);
  const command = nextCommandId(doc);
  writeDocId(doc, docId);
  // Nodes written in this one transaction are not indexed until it commits.
  const written = new Map<SystemRole, LoroTreeNode>();
  for (const spec of SPECS) {
    const parent = spec.parent && written.get(spec.parent);
    const node = parent ? parent.createNode() : store.tree.createNode();
    writeCreationFacts(node, { id: ids[spec.role], kind: spec.kind });
    if (spec.parent) {
      writeListed(node, ids[spec.parent], spec.listed ?? false);
    }
    if (spec.name) {
      nameOf(node).insert(0, spec.name);
    }
    writeSupport(node, command);
    written.set(spec.role, node);
  }
  doc.commit({ origin: GENESIS, timestamp: 0 });
  return doc;
}

/** The system nodes of a document genesis wrote. */
export function readSystemNodes(doc: LoroDoc): SystemNodes {
  const docId = readDocId(doc);
  if (docId === undefined) {
    throw new Error("the document has no workspace id; genesis did not write it");
  }
  return systemNodes(docId);
}
