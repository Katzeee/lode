// Purpose: Guards listing reads: concurrent duplicates read once, a link follows its target's owner, an undone creation hides only from its creation parent, owner changes leave listings alone, and a refused cyclic move loses no listing.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { deleteListings, insertListing } from "../store/listings.ts";
import { writeSupport } from "../store/records.ts";
import { child, command, id, node, replicas, sync } from "./graph.test-support.ts";
import { occurrences } from "./occurrences.ts";

test("concurrent references to one target under one parent read once, at the first position", () => {
  const [a, b] = replicas([{ name: "P" }, { name: "X", parent: "P" }, { name: "T" }]);
  for (const r of [a!, b!]) {
    command(r, [], (cmd) => {
      insertListing(r.store, id("P"), id("T"), 1);
      writeSupport(node(r, "P"), cmd);
    });
  }
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(occurrences(r, id("P")), [
      { parent: id("P"), node: id("X"), link: "original" },
      { parent: id("P"), node: id("T"), link: "reference" },
    ]);
  }
  b!.undo.undo();
  sync(a!, b!);
  deepStrictEqual(
    occurrences(a!, id("P")).map((o) => o.node),
    [id("X"), id("T")],
    "the other replica's reference stays",
  );
});

test("a Trash leaf reads as an original while its target is undone, and as a reference once it is back", () => {
  const [a] = replicas([{ name: "H" }]);
  command(a!, [child("R", "H")]);
  a!.undo.undo();
  // The history module writes this leaf after Undo, in a commit undo skips; here it is written by hand.
  insertListing(a!.store, id("trash"), id("R"), 0);
  a!.store.doc.commit({ origin: "sys:history" });

  deepStrictEqual(occurrences(a!, id("trash")), [{ parent: id("trash"), node: id("R"), link: "original" }]);
  a!.undo.redo();
  deepStrictEqual(occurrences(a!, id("trash")), [{ parent: id("trash"), node: id("R"), link: "reference" }]);
  deepStrictEqual(occurrences(a!, id("H")), [{ parent: id("H"), node: id("R"), link: "original" }]);
});

test("an undone creation is hidden from its creation parent only, and an owner change touches no listing", () => {
  const [a] = replicas([{ name: "H" }, { name: "P" }]);
  command(a!, [child("N", "H")], (cmd) => {
    insertListing(a!.store, id("P"), id("N"));
    writeSupport(node(a!, "P"), cmd);
  });
  a!.undo.undo();
  // P's entry was the command's own write and is gone; re-add one as another command's reference.
  command(a!, [], (cmd) => {
    insertListing(a!.store, id("P"), id("N"));
    writeSupport(node(a!, "P"), cmd);
  });
  deepStrictEqual(
    [occurrences(a!, id("H")), occurrences(a!, id("P"))],
    [[], [{ parent: id("P"), node: id("N"), link: "reference" }]],
  );

  const [b] = replicas([{ name: "H" }, { name: "P" }, { name: "N", parent: "H" }]);
  command(b!, [], (cmd) => {
    node(b!, "N").move(node(b!, "P"));
    writeSupport(node(b!, "N"), cmd);
  });
  deepStrictEqual(
    [occurrences(b!, id("H")), occurrences(b!, id("P"))],
    [[{ parent: id("H"), node: id("N"), link: "reference" }], []],
  );
});

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`when concurrent moves would close a cycle, every node stays listed (peers ${peers.join(",")})`, () => {
    // H lists X and Y. A moves X into Y while B moves Y into X; Loro refuses one tree move.
    const [a, b] = replicas([{ name: "H" }, { name: "X", parent: "H" }, { name: "Y", parent: "H" }], peers);
    const moveInto = (r: NonNullable<typeof a>, moved: string, into: string) =>
      command(r, [], (cmd) => {
        node(r, moved).move(node(r, into));
        deleteListings(r.store, id("H"), id(moved));
        insertListing(r.store, id(into), id(moved));
        for (const each of ["H", moved, into]) {
          writeSupport(node(r, each), cmd);
        }
      });
    moveInto(a!, "X", "Y");
    moveInto(b!, "Y", "X");
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual(
        [
          occurrences(r, id("H")),
          occurrences(r, id("X")).map((o) => o.node),
          occurrences(r, id("Y")).map((o) => o.node),
        ],
        [[], [id("Y")], [id("X")]],
      );
    }
  });
}
