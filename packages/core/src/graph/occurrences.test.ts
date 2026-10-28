// Purpose: Guards that concurrent duplicate references read once and that a leaf's link follows its target's owner.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { createLeaf } from "../store/store.ts";
import { writeSupport } from "../store/records.ts";
import { child, command, id, node, replicas, sync } from "./graph.test-support.ts";
import { occurrences } from "./occurrences.ts";

test("concurrent references to one target under one parent read once, at the first position", () => {
  const [a, b] = replicas([{ name: "P" }, { name: "X", parent: "P" }, { name: "T" }]);
  for (const r of [a!, b!]) {
    command(r, [], (cmd) => {
      createLeaf(node(r, "P"), 1, id("T"));
      writeSupport(node(r, "P"), cmd);
    });
  }
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(occurrences(r, id("P")), [
      { parent: id("P"), node: id("X"), link: "original" },
      { parent: id("P"), node: id("T"), link: "reference" },
    ]);
  }
  b!.undo.undo();
  sync(a!, b!);
  deepStrictEqual(
    occurrences(a!, id("P")).map((o) => o.node),
    [id("X"), id("T")],
    "the other replica's reference stays",
  );
});

test("a Trash leaf reads as an original while its target is undone, and as a reference once it is back", () => {
  const [a] = replicas([{ name: "H" }]);
  command(a!, [child("R", "H")]);
  a!.undo.undo();
  // The history module writes this leaf after Undo, in a commit undo skips; here it is written by hand.
  createLeaf(node(a!, "trash"), 0, id("R"));
  a!.store.doc.commit({ origin: "sys:history" });

  deepStrictEqual(occurrences(a!, id("trash")), [{ parent: id("trash"), node: id("R"), link: "original" }]);
  a!.undo.redo();
  deepStrictEqual(occurrences(a!, id("trash")), [{ parent: id("trash"), node: id("R"), link: "reference" }]);
  deepStrictEqual(occurrences(a!, id("H")), [{ parent: id("H"), node: id("R"), link: "original" }]);
});
