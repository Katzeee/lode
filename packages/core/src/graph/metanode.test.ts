// Purpose: Guards relation liveness at both endpoints and the effective metanode among concurrent candidates.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "../store/allocate.ts";
import { nextCommandId } from "../store/command-id.ts";
import { COMMAND } from "../store/origins.ts";
import { relationRecords, writeRelation } from "../store/relations.ts";
import { writeSupport } from "../store/records.ts";
import { child, command, id, node, replicas, sync } from "./graph.test-support.ts";
import { effectiveMetanode, isMetanode, metanodeTargets, metanodeWriteTarget } from "./metanode.ts";
import { liveMetaRecords } from "./relations.ts";

const meta = (target: string) => ({ type: "meta" as const, target: id(target) });

test("a relation is not live once either endpoint loses presence", () => {
  // The record is a creation fact, written with the allocation, so Undo leaves it stored.
  const [a] = replicas([{ name: "H" }, { name: "M", parent: "H", listed: false }]);
  const cmd = nextCommandId(a!.store.doc);
  allocate(a!.store, cmd, [child("H2", "H")], [{ host: id("H2"), relation: meta("M") }]);
  writeSupport(node(a!, "H2"), cmd);
  a!.store.doc.commit({ origin: COMMAND });
  strictEqual(liveMetaRecords(a!, id("H2")).length, 1);
  a!.undo.undo();
  strictEqual(relationRecords(node(a!, "H2")).length, 1);
  strictEqual(liveMetaRecords(a!, id("H2")).length, 0, "host not present");

  const [b] = replicas([{ name: "H" }]);
  const created = nextCommandId(b!.store.doc);
  allocate(b!.store, created, [child("M", "H", { listed: false })], [{ host: id("H"), relation: meta("M") }]);
  writeSupport(node(b!, "M"), created);
  b!.store.doc.commit({ origin: COMMAND });
  strictEqual(liveMetaRecords(b!, id("H")).length, 1);
  b!.undo.undo();
  strictEqual(relationRecords(node(b!, "H")).length, 1, "the record is a creation fact and stays");
  strictEqual(liveMetaRecords(b!, id("H")).length, 0, "target not present");
  b!.undo.redo();
  strictEqual(liveMetaRecords(b!, id("H")).length, 1);
});

test("concurrent first metanodes: the smallest owned candidate is effective, every candidate is kept", () => {
  const [a, b] = replicas([{ name: "H" }, { name: "Elsewhere" }]);
  command(a!, [child("M2", "H", { listed: false })], (cmd) => writeRelation(a!.store, node(a!, "H"), meta("M2"), cmd));
  command(b!, [child("M1", "Elsewhere", { listed: false })], (cmd) => {
    writeRelation(b!.store, node(b!, "H"), meta("M1"), cmd);
    writeSupport(node(b!, "H"), cmd);
  });
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(metanodeTargets(r, id("H")), [id("M1"), id("M2")]);
    strictEqual(effectiveMetanode(r, id("H")), id("M2"), "M1 is not owned by H");
    strictEqual(metanodeWriteTarget(r, id("H")), id("M1"), "writes follow the pointer, owned or not");
    deepStrictEqual([isMetanode(r, id("M2")), isMetanode(r, id("M1"))], [true, false]);
  }
});
