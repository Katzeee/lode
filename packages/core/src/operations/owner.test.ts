// Purpose: Guards owner changes and moves: promotion keeps every listing alone and racing, a cycle is refused across incarnations, Trash lists a trashed node once at its top, refused moves write nothing, a move carries ownership and its contextual holder, and reorders resolve by last writer, keep an owned node through its creator's Undo and skip an unchanged position, and a source kept present only by the moved child still loses its occurrence.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { effectiveHolder } from "../graph/associations.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { listedNodes, occurrences } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import { tupleValues } from "../graph/tuples.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing, listingEntries } from "../store/listings.ts";
import { sync } from "../store/replicas.test-support.ts";
import { setAssociatedDataFor } from "./associations.ts";
import { unlistFrom } from "./listing.ts";
import { sourceKeptByChild } from "./operations.test-support.ts";
import { moveChildTo, moveToTrash, setOwner } from "./owner.ts";

const H = id("H");
const N = id("N");
const P = id("P");
const Q = id("Q");
const R = id("R");
const trash = id("trash");

const version = (r: Replica) => r.store.doc.oplogVersion().toJSON();
const links = (r: Replica, parent: string) => occurrences(r, id(parent)).map((o) => [o.node, o.link]);

/** H owns and lists N; P and Q each list N by reference; R lists nothing. */
function fixture(peers = [1n, 2n]): Replica[] {
  const rs = replicas([{ name: "H" }, { name: "N", parent: "H" }, { name: "P" }, { name: "Q" }, { name: "R" }], peers);
  run(rs[0]!, (writer) => {
    for (const parent of [P, Q]) {
      writer.touch(parent);
      insertListing(rs[0]!.store, parent, N);
    }
  });
  sync(rs[0]!, rs[1]!);
  return rs;
}

test("promotion keeps every listing, the old owner's now a reference, and Undo restores the owner", () => {
  const [a] = fixture();
  strictEqual(
    run(a!, (writer) => setOwner(writer, N, P)),
    true,
  );
  deepStrictEqual(
    ["H", "P", "Q"].map((parent) => links(a!, parent)),
    [[[N, "reference"]], [[N, "original"]], [[N, "reference"]]],
  );
  history(a!).undo();
  deepStrictEqual([ownerOf(a!, N), links(a!, "H"), links(a!, "P")], [H, [[N, "original"]], [[N, "reference"]]]);
});

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`concurrent promotions keep every listing, each read once with one original (peers ${peers.join(", ")})`, () => {
    const [a, b] = fixture(peers);
    run(a!, (writer) => setOwner(writer, N, P));
    run(b!, (writer) => setOwner(writer, N, Q));
    sync(a!, b!);
    for (const r of [a!, b!]) {
      const all = ["H", "P", "Q"].map((parent) => links(r, parent));
      deepStrictEqual(
        all.map((list) => list.map(([node]) => node)),
        [[N], [N], [N]],
      );
      strictEqual(all.flat().filter(([, link]) => link === "original").length, 1);
    }
  });
}

test("an owner change into the node's own subtree is refused without writes, across incarnations too", () => {
  const [r] = replicas([{ name: "N" }, { name: "C", parent: "N" }]);
  const before = version(r!);
  strictEqual(
    run(r!, (writer) => setOwner(writer, N, id("C"))),
    false,
  );
  deepStrictEqual([version(r!), ownerOf(r!, id("C"))], [before, N]);

  // W hangs under B's incarnation of X; A's incarnation is canonical, so only a NodeId walk sees the cycle.
  const [a, b] = replicas([{ name: "I" }]);
  run(a!, (writer) => writer.create([child("X", "I")]));
  run(b!, (writer) => writer.create([child("X", "I"), child("W", "X")]));
  sync(a!, b!);
  const synced = version(a!);
  strictEqual(
    run(a!, (writer) => setOwner(writer, id("X"), id("W"))),
    false,
  );
  deepStrictEqual([version(a!), ownerOf(a!, id("X"))], [synced, id("I")]);
});

test("trashing lists the node once, at Trash's first entry", () => {
  const [r] = replicas([{ name: "H" }, { name: "N", parent: "H" }, { name: "O", parent: "trash" }]);
  run(r!, (writer) => {
    writer.touch(trash);
    insertListing(r!.store, trash, N);
  });
  run(r!, (writer) => moveToTrash(writer, N));
  deepStrictEqual([ownerOf(r!, N), listingEntries(r!.store, trash)], [trash, [N, id("O")]]);
});

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`concurrent trashing reads once (peers ${peers.join(", ")})`, () => {
    const [a, b] = replicas([{ name: "H" }, { name: "N", parent: "H" }, { name: "O", parent: "trash" }], peers);
    run(a!, (writer) => moveToTrash(writer, N));
    run(b!, (writer) => moveToTrash(writer, N));
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual([ownerOf(r, N), listedNodes(r, trash)], [trash, [N, id("O")]]);
    }
  });
}

test("a move into a parent that lists the node, or an original's move into its subtree, writes nothing", () => {
  const [r] = replicas([
    { name: "H" },
    { name: "P" },
    { name: "S" },
    { name: "N", parent: "H" },
    { name: "C", parent: "N" },
    { name: "K", parent: "H", listed: false },
  ]);
  run(r!, (writer) => {
    writer.touch(P);
    insertListing(r!.store, P, N);
    setAssociatedDataFor(writer, H, N, id("K"));
  });
  const before = version(r!);
  const outcomes = run(r!, (writer) => [moveChildTo(writer, N, H, P), moveChildTo(writer, N, H, id("C"))]);
  deepStrictEqual([outcomes, version(r!), effectiveHolder(r!, H, N)], [[false, false], before, id("K")]);
});

test("a reference moves alone; an original carries its ownership", () => {
  const [a] = fixture();
  strictEqual(
    run(a!, (writer) => moveChildTo(writer, N, P, R)),
    true,
  );
  deepStrictEqual([ownerOf(a!, N), links(a!, "P"), links(a!, "R")], [H, [], [[N, "reference"]]]);
  run(a!, (writer) => moveChildTo(writer, N, H, P, 0));
  deepStrictEqual(
    [ownerOf(a!, N), links(a!, "H"), links(a!, "P"), links(a!, "Q")],
    [P, [], [[N, "original"]], [[N, "reference"]]],
  );
});

test("a moved node takes its contextual holder along, and a target with its own holder refuses the move", () => {
  const [r] = replicas([
    { name: "H" },
    { name: "P" },
    { name: "Q" },
    { name: "N", parent: "H" },
    { name: "K", parent: "H", listed: false },
    { name: "L", parent: "Q", listed: false },
  ]);
  run(r!, (writer) => {
    setAssociatedDataFor(writer, H, N, id("K"));
    setAssociatedDataFor(writer, Q, N, id("L"));
  });
  const before = version(r!);
  strictEqual(
    run(r!, (writer) => moveChildTo(writer, N, H, Q)),
    false,
  );
  deepStrictEqual([version(r!), ownerOf(r!, N)], [before, H]);
  run(r!, (writer) => moveChildTo(writer, N, H, P));
  deepStrictEqual(
    [ownerOf(r!, N), effectiveHolder(r!, P, N), effectiveHolder(r!, H, N), ownerOf(r!, id("K"))],
    [P, id("K"), undefined, P],
  );
});

/** P owns and lists A then N. */
const ordered = (peers?: bigint[]) =>
  replicas([{ name: "P" }, { name: "A", parent: "P" }, { name: "N", parent: "P" }], peers);

test("a reorder to the current position, given or past the end, writes nothing", () => {
  const [r] = ordered();
  const before = version(r!);
  for (const position of [1, 5, undefined]) {
    run(r!, (writer) => moveChildTo(writer, N, P, P, position));
  }
  deepStrictEqual(version(r!), before);
  run(r!, (writer) => moveChildTo(writer, N, P, P, 0));
  deepStrictEqual(listedNodes(r!, P), [N, id("A")]);
});

test("concurrent reorders of one node leave one entry, and a reorder racing an unlist keeps the node", () => {
  const [a, b] = replicas([
    { name: "P" },
    { name: "A", parent: "P" },
    { name: "B", parent: "P" },
    { name: "N", parent: "P" },
  ]);
  run(a!, (writer) => moveChildTo(writer, N, P, P, 0));
  run(b!, (writer) => moveChildTo(writer, N, P, P, 1));
  sync(a!, b!);
  for (const r of [a!, b!]) {
    deepStrictEqual(listingEntries(r.store, P).filter((entry) => entry === N).length, 1);
  }

  const [c, d] = ordered();
  run(c!, (writer) => moveChildTo(writer, N, P, P, 0));
  run(d!, (writer) => unlistFrom(writer, N, P));
  sync(c!, d!);
  for (const r of [c!, d!]) {
    deepStrictEqual(listingEntries(r.store, P), [N, id("A")]);
  }
});

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`a reorder racing the creator's Undo keeps the owned node at its new position (peers ${peers.join(", ")})`, () => {
    const [a, b] = replicas([{ name: "P" }, { name: "A", parent: "P" }], peers);
    run(a!, (writer) => writer.create([child("N", "P")]));
    sync(a!, b!);
    run(b!, (writer) => moveChildTo(writer, N, P, P, 0));
    history(a!).undo();
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual([isPresent(r, N), listedNodes(r, P)], [true, [N, id("A")]]);
    }
  });
}

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  for (const tuple of [false, true]) {
    test(`moving the child that alone keeps its source present still removes it there (${tuple ? "tuple" : "ordinary"} source, peers ${peers.join(", ")})`, () => {
      const [a, b] = sourceKeptByChild(peers, tuple);
      run(b, (writer) => moveChildTo(writer, N, id("P"), Q));
      const values = tupleValues(b, id("P")).map((value) => value.node);
      deepStrictEqual(
        [isPresent(b, id("P")), listingEntries(b.store, id("P")).includes(N), values.length, values.includes(N)],
        [true, false, tuple ? 1 : 0, false],
      );
      sync(a, b);
      history(a).redo();
      sync(a, b);
      for (const r of [a, b]) {
        deepStrictEqual([listedNodes(r, id("P")).includes(N), ownerOf(r, N), listedNodes(r, Q)], [false, Q, [N]]);
      }
      history(b).undo();
      deepStrictEqual([listedNodes(b, id("P")).includes(N), ownerOf(b, N)], [true, id("P")]);
    });
  }
}
