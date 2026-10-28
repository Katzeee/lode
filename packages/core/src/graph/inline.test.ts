// Purpose: Guards that inline reads keep one entry per mention and read nothing from a tuple's name.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { nameOf } from "../store/records.ts";
import { writeMention } from "../store/text.ts";
import { child, command, id, node, replicas } from "./graph.test-support.ts";
import { inlineNodes, inlineOwnedNodes } from "./inline.ts";

test("a target mentioned twice is read twice; a tuple's mentions are not inline nodes", () => {
  const [r] = replicas([{ name: "H" }, { name: "K", parent: "H", listed: false }, { name: "D" }]);
  command(r!, [child("T", "H", { kind: "tuple", tupleDefinitionId: id("D") })], () => {
    writeMention(nameOf(node(r!, "H")), 0, id("K"));
    writeMention(nameOf(node(r!, "H")), 1, id("K"));
    writeMention(nameOf(node(r!, "T")), 0, id("K"));
  });
  deepStrictEqual(inlineNodes(r!, id("H")), [id("K"), id("K")]);
  deepStrictEqual(inlineOwnedNodes(r!, id("H")), [id("K"), id("K")]);
  deepStrictEqual(inlineNodes(r!, id("T")), []);
});
