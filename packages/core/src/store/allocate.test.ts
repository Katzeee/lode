// Purpose: Guards creation facts surviving a command's single-step undo and redo, and the refusal of an allocation it cannot complete before anything is written.

import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import { listingEntries } from "./listings.ts";
import type { NodeId } from "./node-id.ts";
import { COMMAND } from "./origins.ts";
import { kindOf, sourceOf, supportsOf, tupleDefinitionIdOf, writeSupport } from "./records.ts";
import { relationRecords } from "./relations.ts";
import { base, replica } from "./replicas.test-support.ts";
import { nameText } from "./text.ts";

test("undo of a command keeps its allocation and takes one step", () => {
  const a = replica(1n, base([{ id: "H" }]));
  const command = nextCommandId(a.store.doc);
  allocate(
    a.store,
    command,
    [
      { id: "M" as NodeId, parent: "H" as NodeId, listed: false, kind: "metanode" },
      {
        id: "A" as NodeId,
        parent: "M" as NodeId,
        listed: true,
        kind: "tuple",
        tupleDefinitionId: "SYS_A13" as NodeId,
        sourceId: "template-application" as NodeId,
      },
    ],
    [{ host: "H" as NodeId, relation: { type: "meta", target: "M" as NodeId } }],
  );
  for (const id of ["M", "A"]) {
    writeSupport(a.store, id as NodeId, command);
  }
  nameText(a.store, "A" as NodeId).insert(0, "typed");
  a.store.doc.commit({ origin: COMMAND });

  strictEqual(a.undo.undo(), true);
  strictEqual(a.undo.canUndo(), false, "allocation adds no undo step");

  const app = "A" as NodeId;
  deepStrictEqual(
    [
      a.store.ownership.physicalOwner(app),
      kindOf(a.store, app),
      listingEntries(a.store, "M" as NodeId).includes("A" as NodeId),
      relationRecords(a.store, "H" as NodeId).length,
    ],
    ["M", "tuple", true, 1],
  );
  deepStrictEqual([tupleDefinitionIdOf(a.store, app), sourceOf(a.store, app)], ["SYS_A13", "template-application"]);
  deepStrictEqual([supportsOf(a.store, app).size, nameText(a.store, "A" as NodeId).toString()], [0, ""]);

  a.undo.redo();
  deepStrictEqual([tupleDefinitionIdOf(a.store, app), sourceOf(a.store, app)], ["SYS_A13", "template-application"]);
  deepStrictEqual([supportsOf(a.store, app).size, nameText(a.store, "A" as NodeId).toString()], [1, "typed"]);
});

test("an id already allocated or repeated, and a parent or host not allocated before it, are refused before anything is written", () => {
  const a = replica(1n, base([{ id: "H" }, { id: "N", parent: "H" }]));
  const version = a.store.doc.oplogVersion().toJSON();
  const allocation = (id: string) => ({ id: id as NodeId, parent: "H" as NodeId, listed: true });
  throws(() => allocate(a.store, nextCommandId(a.store.doc), [allocation("X"), allocation("N")]), /already allocated/);
  throws(() => allocate(a.store, nextCommandId(a.store.doc), [allocation("X"), allocation("X")]), /already allocated/);
  const forward = [allocation("X"), { ...allocation("Y"), parent: "Z" as NodeId }, allocation("Z")];
  throws(() => allocate(a.store, nextCommandId(a.store.doc), forward), /not allocated before it/);
  const host = [{ host: "U" as NodeId, relation: { type: "meta" as const, target: "X" as NodeId } }];
  throws(() => allocate(a.store, nextCommandId(a.store.doc), [allocation("X")], host), /not allocated/);
  deepStrictEqual([a.store.doc.oplogVersion().toJSON(), a.store.has("X" as NodeId)], [version, false]);
  strictEqual(a.store.ownership.incarnationParents("N" as NodeId).length, 1);
});
