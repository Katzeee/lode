// Purpose: Guards which template nodes are shared rather than projected: field definitions, and options only through the exact owner chain.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { child, command, id, replicas } from "../graph/graph.test-support.ts";
import { tag } from "../tags/tags.test-support.ts";
import { mergedList } from "./merged.ts";
import { outlineLines } from "./outline.ts";
import { children, template } from "./projection.test-support.ts";
import { materializeAsSelf } from "./sharing.ts";

/** Option O ← options tuple OT ← field definition F ← tuple T ← `owner`; F is listed by T as its value. */
function chain(owner: "A" | "Plain") {
  const [r] = replicas([{ name: "Plain" }, { name: "D" }]);
  template(r!, "A");
  command(r!, [
    child("T", owner, { kind: "tuple", tupleDefinitionId: id("D") }),
    child("F", "T"),
    child("OT", "F", { kind: "tuple", tupleDefinitionId: id("options") }),
    child("O", "OT"),
  ]);
  tag(r!, "F", ["fieldDefinition"]);
  return r!;
}

test("an option is shared only when its owner chain ends in a supertag", () => {
  strictEqual(materializeAsSelf(chain("A"), id("O")), true);
  strictEqual(materializeAsSelf(chain("Plain"), id("O")), false);
});

test("a field definition a template owns shows under the instance as itself, as an original", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A");
  children(r!, "A", "F");
  tag(r!, "F", ["fieldDefinition"]);
  tag(r!, "I", ["A"]);

  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "outline" }).map((entry) => [entry.node, entry.filledBy]),
    [[id("F"), "projection"]],
  );
  deepStrictEqual(outlineLines(r!, id("I"))[0]!.link, "original");
});
