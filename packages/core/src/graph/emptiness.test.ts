// Purpose: Guards field-value emptiness by the first tuple of a field.

import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { isEmpty } from "./emptiness.ts";
import { child, command, id, replicas } from "./graph.test-support.ts";

for (const namedFirst of [false, true]) {
  test(`a parent's emptiness follows the first tuple of a field (named tuple first: ${namedFirst})`, () => {
    const [r] = replicas([{ name: "H" }, { name: "D" }]);
    const tuple = (name: string) => child(name, "H", { kind: "tuple", tupleDefinitionId: id("D") });
    const [first, second] = namedFirst ? ["T2", "T1"] : ["T1", "T2"];
    command(r!, [tuple(first), tuple(second), child("V1", "T1"), child("V2", "T2")], () =>
      r!.store.name(id("V2")).insert(0, "named"),
    );
    strictEqual(isEmpty(r!, id("H")), !namedFirst);
  });
}
