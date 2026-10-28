// Purpose: Guards holder reclaimability with an unowned metanode pointer, and field-value emptiness by the first tuple of a field.

import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { nameOf, writeSupport } from "../store/records.ts";
import { writeRelation } from "../store/relations.ts";
import { holderIsEmpty, isEmpty } from "./emptiness.ts";
import { child, command, id, node, replicas } from "./graph.test-support.ts";

test("a holder whose live metanode pointer names a node it does not own is not reclaimable", () => {
  const [r] = replicas([{ name: "H" }, { name: "K" }, { name: "M", parent: "H", listed: false }]);
  strictEqual(holderIsEmpty(r!, id("K")), true, "no pointer: resolved and empty");
  command(r!, [], (cmd) => {
    writeRelation(r!.store, node(r!, "K"), { type: "meta", target: id("M") }, cmd);
    writeSupport(node(r!, "K"), cmd);
  });
  strictEqual(holderIsEmpty(r!, id("K")), false);
});

for (const namedFirst of [false, true]) {
  test(`a parent's emptiness follows the first tuple of a field (named tuple first: ${namedFirst})`, () => {
    const [r] = replicas([{ name: "H" }, { name: "D" }]);
    const tuple = (name: string) => child(name, "H", { kind: "tuple", tupleDefinitionId: id("D") });
    const [first, second] = namedFirst ? ["T2", "T1"] : ["T1", "T2"];
    command(r!, [tuple(first), tuple(second), child("V1", "T1"), child("V2", "T2")], () =>
      nameOf(node(r!, "V2")).insert(0, "named"),
    );
    strictEqual(isEmpty(r!, id("H")), !namedFirst);
  });
}
