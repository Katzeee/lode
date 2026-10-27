// Purpose: Guards creation facts surviving a command's single-step undo and redo.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { COMMAND } from "./origins.ts";
import { kindOf, listedBy, nameOf, sourceOf, supportsOf, tupleDefinitionIdOf, writeSupport } from "./records.ts";
import { relationRecords } from "./relations.ts";
import { base, node, replica } from "./replicas.test-support.ts";
import { parentIdOf } from "./store.ts";

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
    writeSupport(node(a, id), command);
  }
  nameOf(node(a, "A")).insert(0, "typed");
  a.store.doc.commit({ origin: COMMAND });

  strictEqual(a.undo.undo(), true);
  strictEqual(a.undo.canUndo(), false, "allocation adds no undo step");

  const app = node(a, "A");
  deepStrictEqual(
    [parentIdOf(app), kindOf(app), listedBy(app, "M" as NodeId), relationRecords(node(a, "H")).length],
    ["M", "tuple", true, 1],
  );
  deepStrictEqual([tupleDefinitionIdOf(app), sourceOf(app)], ["SYS_A13", "template-application"]);
  deepStrictEqual([supportsOf(app).size, nameOf(app).toString()], [0, ""]);

  a.undo.redo();
  deepStrictEqual([tupleDefinitionIdOf(app), sourceOf(app)], ["SYS_A13", "template-application"]);
  deepStrictEqual([supportsOf(app).size, nameOf(app).toString()], [1, "typed"]);
});
