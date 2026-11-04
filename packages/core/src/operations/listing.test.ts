// Purpose: Guards listing primitives: a reference listed under an undone node's creation parent leaves the node not present in Trash, a tuple left without a value gets one new empty value whether its last value was owned or a reference, and removing both values in one command leaves exactly one.

import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { lists, occurrences } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import { tupleValues } from "../graph/tuples.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing } from "../store/listings.ts";
import { readsReal } from "../store/records.ts";
import { addChild, removeChild } from "./listing.ts";

const H = id("H");
const N = id("N");
const T = id("T");
const V = id("V");
const X = id("X");
const trash = id("trash");

test("a reference listed under an undone node's creation parent leaves the node owned and listed by Trash and not present", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, (writer) => writer.create([child("N", "H", { kind: "tagDef" })]));
  history(r!).undo();
  run(r!, (writer) => addChild(writer, H, N));
  deepStrictEqual(
    [isPresent(r!, N), ownerOf(r!, N), occurrences(r!, H), lists(r!, trash, N), readsReal(r!.store, N)],
    [false, trash, [{ parent: H, node: N, link: "reference" }], true, true],
  );
  deepStrictEqual(occurrences(r!, trash), [{ parent: trash, node: N, link: "original" }]);

  history(r!).undo();
  deepStrictEqual([occurrences(r!, H), readsReal(r!.store, N), lists(r!, trash, N)], [[], false, true]);
});

test("removing that reference again leaves the undone node not present", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, (writer) => writer.create([child("N", "H")]));
  history(r!).undo();
  run(r!, (writer) => addChild(writer, H, N));
  run(r!, (writer) => removeChild(writer, H, N));
  deepStrictEqual([isPresent(r!, N), occurrences(r!, H), ownerOf(r!, N)], [false, [], trash]);
});

/** Tuple T under H with definition F and one value: V owned by T, or a reference to X. */
function tuple(r: Replica, owned: boolean): void {
  run(r, (writer) => {
    writer.create([
      child("T", "H", { kind: "tuple", tupleDefinitionId: id("F") }),
      ...(owned ? [child("V", "T")] : []),
    ]);
    if (!owned) {
      writer.touch(T);
      insertListing(r.store, T, X);
    }
  });
}

for (const owned of [true, false]) {
  test(`removing a tuple's last ${owned ? "owned" : "reference"} value leaves one new empty value`, () => {
    const [r] = replicas([{ name: "H" }, { name: "F" }, { name: "X", parent: "H" }]);
    tuple(r!, owned);
    const removed = owned ? V : X;
    run(r!, (writer) => removeChild(writer, T, removed));
    const values = tupleValues(r!, T);
    strictEqual(values.length, 1);
    notStrictEqual(values[0]!.node, removed);
    deepStrictEqual([values[0]!.link, ownerOf(r!, removed)], ["original", owned ? undefined : H]);
  });
}

test("removing both values of a tuple in one command leaves one empty value, undone as one step", () => {
  const [r] = replicas([{ name: "H" }, { name: "F" }]);
  run(r!, (writer) =>
    writer.create([child("T", "H", { kind: "tuple", tupleDefinitionId: id("F") }), child("V1", "T"), child("V2", "T")]),
  );
  run(r!, (writer) => {
    removeChild(writer, T, id("V1"));
    removeChild(writer, T, id("V2"));
  });
  const values = tupleValues(r!, T).map((value) => value.node);
  strictEqual(values.length, 1);
  strictEqual([id("V1"), id("V2")].includes(values[0]!), false);
  history(r!).undo();
  deepStrictEqual(
    tupleValues(r!, T).map((value) => value.node),
    [id("V1"), id("V2")],
  );
});
