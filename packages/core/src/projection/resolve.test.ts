// Purpose: Guards the resolution boundary: a projection reads its current copy, through saved and nested addresses alike, and reads the template again once the copy retires; reading never allocates.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { child, command, id, type Replica, replicas } from "../graph/graph.test-support.ts";
import type { NodeId } from "../store/node-id.ts";
import { writeSupport } from "../store/records.ts";
import { supertags, tag } from "../tags/tags.test-support.ts";
import { copyId, isProjected, type NodeAddress, type Projected } from "./address.ts";
import { mergedList } from "./merged.ts";
import { nameAs } from "./projection.test-support.ts";
import { project } from "./proxy.ts";
import { nameKey } from "./readers.ts";
import { resolveAddress } from "./resolve.ts";

const context = { instance: id("I"), root: id("R"), mode: "template" } as const;

/**
 * Instance I is tagged T; T owns R; R owns supertag U and N; U owns chat C named "template"; N is
 * tagged U and owns Z, whose name is the text of C's copy id.
 */
function fixture(): Replica {
  const [r] = replicas([{ name: "I" }, { name: "Q" }, { name: "T" }, { name: "supertag" }]);
  command(r!, [child("R", "T"), child("U", "R"), child("N", "R"), child("C", "U", { kind: "chat" }), child("Z", "N")]);
  supertags(r!, "T", "U");
  tag(r!, "N", ["U"]);
  tag(r!, "I", ["T"]);
  nameAs(r!, "Z", "~(I,C)");
  nameAs(r!, "C", "template");
  return r!;
}

function moveAs(r: Replica, node: NodeId, owner: NodeId): void {
  command(r, [], (cmd) => {
    r.store.ownership.moveOwner(node, owner);
    writeSupport(r.store, node, cmd);
  });
}

test("a name equal to a copy id never matches the projection's identity", () => {
  const r = fixture();
  const entries = mergedList(r, project(r, context, id("N")), { kind: "outline" });
  deepStrictEqual(
    [entries[0]?.filledBy, r.store.has(copyId(project(r, context, id("C")) as Projected))],
    ["projection", false],
  );
});

test("a saved projected address reads the current copy, and the template again once it retires", () => {
  const r = fixture();
  const saved: NodeAddress = project(r, context, id("C"));
  const copy = copyId(saved as Projected);
  command(r, [child(copy, "I", { kind: "chat", sourceId: id("C") })]);
  nameAs(r, copy, "edited copy");
  const reads = () => [nameKey(r, saved), project(r, context, id("C"))];
  deepStrictEqual(reads(), ["edited copy", copy]);

  moveAs(r, copy, id("trash"));
  deepStrictEqual([reads()[0], nameKey(r, copy)], ["template", "edited copy"], "a deleted copy stays readable by id");
  r.undo.undo();
  deepStrictEqual(reads()[0], "edited copy", "undoing the delete rebinds it");

  moveAs(r, copy, id("Q"));
  deepStrictEqual(reads()[0], "template", "a copy moved out of its instance leaves the slot to the template");
  r.undo.undo();

  r.undo.undo();
  r.undo.undo();
  deepStrictEqual(reads()[0], "template", "an undone creation leaves the slot to the template");
});

test("a new copy after a retired one takes the next generation and binds", () => {
  const r = fixture();
  const saved: NodeAddress = project(r, context, id("C"));
  const copy = copyId(saved as Projected);
  command(r, [child(copy, "I", { kind: "chat", sourceId: id("C") })]);
  moveAs(r, copy, id("trash"));
  const next = `${copy}#1` as NodeId;
  command(r, [child(next, "I", { kind: "chat", sourceId: id("C") })]);
  nameAs(r, next, "second copy");
  deepStrictEqual([resolveAddress(r, saved), nameKey(r, saved)], [next, "second copy"]);
});

for (const outerFirst of [true, false]) {
  test(`a nested projection resolves to one copy whichever layer was copied first (outer first: ${outerFirst})`, () => {
    const r = fixture();
    const n = project(r, context, id("N"));
    const nested: NodeAddress = mergedList(r, n, { kind: "outline" })[0]!.node;
    strictEqual(isProjected(nested), true);
    const id0 = copyId(nested as Projected);
    const layers: [NodeId, NodeAddress][] = [
      [copyId(n as Projected), id("N")],
      [copyId(project(r, context, id("C")) as Projected), id("C")],
    ];
    for (const [copy, source] of outerFirst ? layers : [...layers].reverse()) {
      command(r, [child(copy, "I", { sourceId: source as NodeId })]);
    }
    strictEqual(r.store.has(id0), false, "reads allocate nothing");
    strictEqual(copyId(resolveAddress(r, nested) as Projected), id0);
    command(r, [child(id0, copyId(n as Projected), { kind: "chat" })]);
    nameAs(r, id0, "nested copy");
    deepStrictEqual([resolveAddress(r, nested), nameKey(r, nested)], [id0, "nested copy"]);
  });
}
