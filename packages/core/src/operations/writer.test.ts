// Purpose: Guards that a made-real node another replica builds on keeps reading real after the maker's Undo, empty and without kind (a seeded one reads its restored seed), keeps that replica's direct name edit, and reads its creation name again once the dependency is withdrawn and the creator redoes.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { Delta } from "loro-crdt";
import { nameOf, writableName } from "../graph/content.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { listedNodes } from "../graph/occurrences.ts";
import { isPresent, kindRead, tupleDefinitionRead } from "../graph/presence.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { sync } from "../store/replicas.test-support.ts";

const D = id("D");
const E = id("E");
const Q = id("Q");
const base: Delta<string>[] = [{ insert: "To", attributes: { bold: true } }, { insert: "do" }];

const append = (r: Replica, node: NodeId, text: string) => {
  const name = writableName(r, node);
  name.insert(name.length, text);
};

const syncAll = (x: Replica, a: Replica, b: Replica) => {
  sync(x, a);
  sync(a, b);
  sync(x, a);
};

type Dependency = "reference in D" | "edit of child E" | "edit of D's name";

/**
 * X creates D, a copy, and undoes. A writes into D, making it real, and with the child dependency
 * also creates E under D. B builds on that, then A undoes everything; later B undoes and X redoes.
 */
function scenario(dependency: Dependency, seeded: boolean) {
  const [x, a, b] = replicas([{ name: "I" }, { name: "Q" }], [1n, 2n, 3n]) as [Replica, Replica, Replica];
  run(x, (writer) => {
    writer.create([child("D", "I", { kind: "tuple", tupleDefinitionId: id("F"), sourceId: id("S"), nameBase: base })]);
    if (seeded) {
      append(x, D, "!");
    }
  });
  history(x).undo();
  syncAll(x, a, b);
  run(a, (writer) => {
    writer.touch(D);
    append(a, D, "A");
  });
  if (dependency === "edit of child E") {
    run(a, (writer) => writer.create([child("E", "D")]));
  }
  syncAll(x, a, b);
  run(b, (writer) => {
    if (dependency === "reference in D") {
      writer.touch(D);
      insertListing(b.store, D, Q);
    } else if (dependency === "edit of child E") {
      writer.touch(E);
      append(b, E, "B");
    } else {
      writer.touch(D);
      append(b, D, "B");
    }
  });
  syncAll(x, a, b);
  while (history(a).undo()) {
    // A undoes every command it ran.
  }
  syncAll(x, a, b);
  const afterMakerUndo = [x, a, b].map((r) => [
    isPresent(r, D),
    kindRead(r, D),
    tupleDefinitionRead(r, D),
    nameOf(r, D),
  ]);
  const referenceKept = [x, a, b].map((r) => listedNodes(r, D).includes(Q));
  history(b).undo();
  syncAll(x, a, b);
  history(x).redo();
  syncAll(x, a, b);
  const afterRedo = [x, a, b].map((r) => [kindRead(r, D), nameOf(r, D)]);
  return { afterMakerUndo, referenceKept, afterRedo };
}

const thrice = <T>(value: T) => [value, value, value];

for (const dependency of ["reference in D", "edit of child E"] as const) {
  test(`a made-real node kept by another replica's ${dependency} reads empty and without kind after the maker's Undo`, () => {
    const { afterMakerUndo, referenceKept } = scenario(dependency, false);
    deepStrictEqual(afterMakerUndo, thrice([true, undefined, undefined, []]));
    if (dependency === "reference in D") {
      deepStrictEqual(referenceKept, thrice(true));
    }
  });

  test(`after the ${dependency} is withdrawn, the creator's Redo reads the base of an unseeded node`, () => {
    deepStrictEqual(scenario(dependency, false).afterRedo, thrice(["tuple", base]));
  });

  // Lode's policy for a state only other replicas reach: the maker's Undo restores the seeded
  // characters its make-real deleted, and the dependency's real key keeps the node reading its text.
  test(`a seeded made-real node kept by another replica's ${dependency} reads its restored seed after the maker's Undo`, () => {
    const { afterMakerUndo, afterRedo } = scenario(dependency, true);
    deepStrictEqual(afterMakerUndo, thrice([true, undefined, undefined, base]));
    deepStrictEqual(afterRedo, thrice(["tuple", [{ insert: "To", attributes: { bold: true } }, { insert: "do!" }]]));
  });
}

test("another replica's direct name edit on a made-real node stays after the maker's Undo", () => {
  const { afterMakerUndo, afterRedo } = scenario("edit of D's name", false);
  deepStrictEqual(afterMakerUndo, thrice([true, undefined, undefined, [{ insert: "B" }]]));
  deepStrictEqual(afterRedo, thrice(["tuple", base]));
});
