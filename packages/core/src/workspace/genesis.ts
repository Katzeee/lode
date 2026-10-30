// Purpose: Writes a workspace's system nodes identically on every replica, so merging yields one set.

import type { LoroDoc, LoroTreeNode } from "loro-crdt";
import { systemNodes, type SystemNodes, type SystemRole } from "../graph/system-nodes.ts";
import { nextCommandId, type CommandId } from "../store/command-id.ts";
import { readDocId, writeDocId, type DocId } from "../store/doc-id.ts";
import { GENESIS } from "../store/origins.ts";
import { insertListing } from "../store/listings.ts";
import { writeCreationFacts, writeSupport, type Kind } from "../store/records.ts";
import type { NodeId } from "../store/node-id.ts";
import { writeRelation } from "../store/relations.ts";
import { Store } from "../store/store.ts";

/** Reserved for genesis; no replica is ever leased this peer id. */
const GENESIS_PEER = 0n;

type SystemSpec = {
  role: SystemRole;
  parent?: SystemRole;
  listed?: boolean;
  kind?: Kind;
  name?: string;
  /** The definition's one tag, which gives it its role. */
  tag?: SystemRole;
};

/**
 * Fixed order and fixed ids. The containers are listed under the root; the definition roles and the
 * empty value are owned by the root but unlisted, so no outline shows them. Kinds and tags follow the
 * reference system's own system nodes: the supertag and field-definition markers are supertags (the
 * supertag marker tags itself), so is the metanode template, and the options and tags fields are
 * field definitions. The metanode template's own system fields are outside what genesis writes.
 */
const SPECS: readonly SystemSpec[] = [
  { role: "root" },
  { role: "home", parent: "root", listed: true, kind: "home", name: "Home" },
  { role: "trash", parent: "root", listed: true, name: "Trash" },
  { role: "schema", parent: "root", listed: true, name: "Schema" },
  { role: "supertag", parent: "root", kind: "tagDef", name: "supertag", tag: "supertag" },
  { role: "fieldDefinition", parent: "root", kind: "tagDef", name: "field definition", tag: "supertag" },
  { role: "options", parent: "root", name: "options", tag: "fieldDefinition" },
  { role: "tags", parent: "root", name: "supertags", tag: "fieldDefinition" },
  { role: "metaTemplate", parent: "root", kind: "tagDef", name: "meta information", tag: "supertag" },
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
      if (spec.listed) {
        insertListing(store, ids[spec.parent], ids[spec.role]);
      }
    }
    if (spec.name) {
      store.name(ids[spec.role]).insert(0, spec.name);
    }
    writeSupport(node, command);
    written.set(spec.role, node);
    if (spec.tag) {
      writeTag(store, node, ids[spec.role], ids, ids[spec.tag], command);
    }
  }
  doc.commit({ origin: GENESIS, timestamp: 0 });
  return doc;
}

/** A metanode under `host` whose application holds one reference to `tag`, all under fixed ids. */
function writeTag(
  store: Store,
  host: LoroTreeNode,
  hostId: NodeId,
  ids: SystemNodes,
  tag: NodeId,
  command: CommandId,
): void {
  const metanodeId = `${hostId}:meta` as NodeId;
  const metanode = host.createNode();
  writeCreationFacts(metanode, { id: metanodeId, kind: "metanode" });
  writeSupport(metanode, command);
  writeRelation(store, host, { type: "meta", target: metanodeId }, command);
  const applicationId = `${metanodeId}:tags` as NodeId;
  const application = metanode.createNode();
  writeCreationFacts(application, { id: applicationId, kind: "tuple", tupleDefinitionId: ids.tags });
  insertListing(store, metanodeId, applicationId);
  writeSupport(application, command);
  insertListing(store, applicationId, tag);
}

/** The system nodes of a document genesis wrote. */
export function readSystemNodes(doc: LoroDoc): SystemNodes {
  const docId = readDocId(doc);
  if (docId === undefined) {
    throw new Error("the document has no workspace id; genesis did not write it");
  }
  return systemNodes(docId);
}
