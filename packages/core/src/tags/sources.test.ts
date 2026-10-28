// Purpose: Guards the two template-source orders and the repeat a shared ancestor leaves in them.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { id, replicas } from "../graph/graph.test-support.ts";
import { allTemplates, allTemplatesForInitialization } from "./sources.ts";
import { tag } from "./tags.test-support.ts";

test("outline order interleaves ancestors per tag; initialization order puts every ancestor first", () => {
  const [r] = replicas([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "I" }, { name: "J" }]);
  for (const each of ["A", "C"]) {
    tag(r!, each, ["supertag"]);
  }
  tag(r!, "B", ["supertag", "C"]);
  tag(r!, "I", ["A", "B"]);
  deepStrictEqual(allTemplates(r!, id("I")), ["A", "C", "B"].map(id));
  deepStrictEqual(allTemplatesForInitialization(r!, id("I")), ["C", "A", "B"].map(id));

  // C is reached through D first; through B it adds no ancestors but is listed again.
  tag(r!, "D", ["supertag", "C"]);
  tag(r!, "J", ["D", "B"]);
  deepStrictEqual(allTemplates(r!, id("J")), ["C", "D", "C", "B"].map(id));
});
