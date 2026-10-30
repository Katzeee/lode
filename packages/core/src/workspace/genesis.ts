// Purpose: Writes a workspace's system nodes identically on every replica, so merging yields one set.

import type { LoroDoc } from "loro-crdt";
import { systemNodes, type SystemNodes, type SystemRole } from "../graph/system-nodes.ts";
import { writeAllocation } from "../store/allocate.ts";
import { nextCommandId, type CommandId } from "../store/command-id.ts";
import { applicationId, metanodeId } from "../store/derived-id.ts";
import { readDocId, writeDocId, type DocId } from "../store/doc-id.ts";
import { GENESIS } from "../store/origins.ts";
import { insertListing } from "../store/listings.ts";
import { writeSupport, type Kind } from "../store/records.ts";
import { nameText } from "../store/text.ts";
import type { NodeId } from "../store/node-id.ts";
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
  for (const { role, parent, listed = false, kind, name, tag } of SPECS) {
    const id = ids[role];
    writeAllocation(store, command, [{ id, parent: parent && ids[parent], listed, kind }]);
    // System nodes are named directly: they are not copies, so they have no name base.
    if (name) {
      nameText(store, id).insert(0, name);
    }
    writeSupport(store, id, command);
    if (tag) {
      writeTag(store, id, ids, ids[tag], command);
    }
  }
  doc.commit({ origin: GENESIS, timestamp: 0 });
  return doc;
}

/**
 * A metanode under `host` whose application holds one reference to `tag`, under the first generation
 * of the derived ids every metanode and application takes.
 */
function writeTag(store: Store, host: NodeId, ids: SystemNodes, tag: NodeId, command: CommandId): void {
  const metanode = metanodeId(host);
  const application = applicationId(metanode);
  writeAllocation(
    store,
    command,
    [
      { id: metanode, parent: host, listed: false, kind: "metanode" },
      { id: application, parent: metanode, listed: true, kind: "tuple", tupleDefinitionId: ids.tags },
    ],
    [{ host, relation: { type: "meta", target: metanode } }],
  );
  writeSupport(store, metanode, command);
  writeSupport(store, application, command);
  insertListing(store, application, tag);
}

/** The system nodes of a document genesis wrote. */
export function readSystemNodes(doc: LoroDoc): SystemNodes {
  const docId = readDocId(doc);
  if (docId === undefined) {
    throw new Error("the document has no workspace id; genesis did not write it");
  }
  return systemNodes(docId);
}
