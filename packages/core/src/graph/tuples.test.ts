// Purpose: Guards the read of a tuple whose last values were deleted concurrently, and of one value deleted twice.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { writeListed, writeSupport } from "../store/records.ts";
import { isStrictlyEmpty } from "./emptiness.ts";
import { child, command, id, node, replicas, sync, type Replica } from "./graph.test-support.ts";
import { isTuple, valueSlots } from "./tuples.ts";

/** A field use T with definition D and two values; unlisting stands in for deletion here. */
function fixture() {
  const rs = replicas([{ name: "H" }, { name: "D" }]);
  const [a, b] = rs as [Replica, Replica];
  command(a, [child("T", "H", { kind: "tuple", tupleDefinitionId: id("D") }), child("V1", "T"), child("V2", "T")]);
  sync(a, b);
  return [a, b] as const;
}

function unlist(r: Replica, value: string): void {
  command(r, [], (cmd) => {
    writeListed(node(r, value), id("T"), false);
    writeSupport(node(r, "T"), cmd);
  });
}

test("concurrent deletes of the last two values read as one input position", () => {
  const [a, b] = fixture();
  unlist(a, "V1");
  unlist(b, "V2");
  sync(a, b);

  for (const r of [a, b]) {
    strictEqual(isTuple(r, id("T")), false);
    const slots = valueSlots(r, id("T"));
    deepStrictEqual(slots, [{ tuple: id("T"), input: true }]);
    strictEqual(isStrictlyEmpty(r, { tuple: id("T"), input: true }), true);
  }
});

test("two replicas deleting the same last value keep both replacement values", () => {
  const [a, b] = fixture();
  unlist(a, "V2");
  sync(a, b);
  for (const [r, name] of [
    [a, "E1"],
    [b, "E2"],
  ] as const) {
    command(r, [child(name, "T")], (cmd) => {
      writeListed(node(r, "V1"), id("T"), false);
      writeSupport(node(r, "T"), cmd);
    });
  }
  sync(a, b);

  for (const r of [a, b]) {
    const values = valueSlots(r, id("T"))!.map((slot) => ("node" in slot ? slot.node : "input"));
    deepStrictEqual(values.sort(), [id("E1"), id("E2")]);
  }
});
