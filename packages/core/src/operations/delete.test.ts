// Purpose: Guards deletion: a deleted holder stays associated, Home, Schema and a definition are refused without writes, references to Schema and to a definition are deleted, and a parent kept present only by the deleted child still loses its occurrence.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { effectiveHolder } from "../graph/associations.ts";
import { nameString } from "../graph/content.ts";
import { id, replicas } from "../graph/graph.test-support.ts";
import { listedNodes, lists, occurrences } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import { tupleValues } from "../graph/tuples.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing, listingEntries } from "../store/listings.ts";
import { sync } from "../store/replicas.test-support.ts";
import { setAssociatedDataFor } from "./associations.ts";
import { deleteMe } from "./delete.ts";
import { sourceKeptByChild, workspace } from "./operations.test-support.ts";

const H = id("H");
const K = id("K");
const N = id("N");
const P = id("P");
const S = id("S");
const root = id("root");

test("a deleted holder goes to the top of Trash and stays associated", () => {
  const [r] = replicas([{ name: "H" }, { name: "S" }, { name: "K", parent: "H", listed: false }]);
  run(r!, (writer) => setAssociatedDataFor(writer, H, S, K));
  run(r!, (writer) => deleteMe(writer, K, H));
  deepStrictEqual(
    [ownerOf(r!, K), occurrences(r!, id("trash"))[0]?.node, isPresent(r!, K), effectiveHolder(r!, H, S)],
    [id("trash"), K, true, K],
  );
});

test("deleting Home, Schema or a definition from the root writes nothing", () => {
  const [r] = workspace([]);
  const version = r!.store.doc.oplogVersion().toJSON();
  for (const node of ["home", "schema", "supertag"]) {
    run(r!, (writer) => deleteMe(writer, id(node), root));
  }
  deepStrictEqual(r!.store.doc.oplogVersion().toJSON(), version);
  deepStrictEqual(
    ["home", "schema"].map((node) => lists(r!, root, id(node))),
    [true, true],
  );
});

test("references to Schema and to a definition are deleted, and their owners stay", () => {
  const [r] = workspace([{ name: "H", parent: "home" }]);
  run(r!, (writer) => {
    writer.touch(H);
    insertListing(r!.store, H, id("schema"));
    insertListing(r!.store, H, id("supertag"));
  });
  for (const node of ["schema", "supertag"]) {
    run(r!, (writer) => deleteMe(writer, id(node), H));
  }
  deepStrictEqual([occurrences(r!, H), ownerOf(r!, id("schema")), ownerOf(r!, id("supertag"))], [[], root, root]);
  strictEqual(lists(r!, root, id("schema")), true);
});

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  for (const tuple of [false, true]) {
    test(`deleting the child that alone keeps its parent present still removes it there (${tuple ? "tuple" : "ordinary"} parent, peers ${peers.join(", ")})`, () => {
      const [a, b] = sourceKeptByChild(peers, tuple);
      run(b, (writer) => deleteMe(writer, N, P));
      const values = tupleValues(b, P).map((value) => value.node);
      deepStrictEqual(
        [isPresent(b, P), listingEntries(b.store, P).includes(N), values.length, values.includes(N)],
        [true, false, tuple ? 1 : 0, false],
      );
      sync(a, b);
      history(a).redo();
      sync(a, b);
      for (const r of [a, b]) {
        deepStrictEqual(
          [listedNodes(r, P).includes(N), ownerOf(r, N), nameString(r, N)],
          [false, id("trash"), "remote"],
        );
      }
    });
  }
}
