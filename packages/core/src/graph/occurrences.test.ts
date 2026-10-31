// Purpose: Guards listing reads: concurrent duplicates read once, a link follows its target's owner, an undone creation hides only from its creation parent while Trash keeps listing what it owns, owner changes leave listings alone, a refused cyclic move loses no listing, and visible positions map to the entry indexes inserts and moves need.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { LoroMovableList } from "loro-crdt";
import { allocate } from "../store/allocate.ts";
import { nextCommandId } from "../store/command-id.ts";
import { deleteListings, insertListing, listingEntries } from "../store/listings.ts";
import { writeSupport } from "../store/records.ts";
import { child, command, id, replicas, type Replica } from "./graph.test-support.ts";
import { sync } from "../store/replicas.test-support.ts";
import { entryIndexForInsert, entryIndexForMove, listedNodes, occurrences } from "./occurrences.ts";

test("concurrent references to one target under one parent read once, at the first position", () => {
  const [a, b] = replicas([{ name: "P" }, { name: "X", parent: "P" }, { name: "T" }]);
  for (const r of [a!, b!]) {
    command(r, [], (cmd) => {
      insertListing(r.store, id("P"), id("T"), 1);
      writeSupport(r.store, id("P"), cmd);
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
    writeSupport(a!.store, id("P"), cmd);
  });
  a!.undo.undo();
  // P's entry was the command's own write and is gone; re-add one as another command's reference.
  command(a!, [], (cmd) => {
    insertListing(a!.store, id("P"), id("N"));
    writeSupport(a!.store, id("P"), cmd);
  });
  deepStrictEqual(
    [occurrences(a!, id("H")), occurrences(a!, id("P"))],
    [[], [{ parent: id("P"), node: id("N"), link: "reference" }]],
  );

  const [b] = replicas([{ name: "H" }, { name: "P" }, { name: "N", parent: "H" }]);
  command(b!, [], (cmd) => {
    b!.store.ownership.moveOwner(id("N"), id("P"));
    writeSupport(b!.store, id("N"), cmd);
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
        r.store.ownership.moveOwner(id(moved), id(into));
        deleteListings(r.store, id("H"), id(moved));
        insertListing(r.store, id(into), id(moved));
        for (const each of ["H", moved, into]) {
          writeSupport(r.store, id(each), cmd);
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

test("Trash keeps listing a node it owns once the node's creation is undone, while another creation parent hides its own", () => {
  // As the first tag's empty value: created under Trash and listed there, beside a node created under H.
  const [a] = replicas([{ name: "H" }]);
  command(a!, [child("V", "trash"), child("N", "H")]);
  a!.undo.undo();

  deepStrictEqual(
    [occurrences(a!, id("trash")), occurrences(a!, id("H"))],
    [[{ parent: id("trash"), node: id("V"), link: "original" }], []],
  );
});

/**
 * P's entries are X, A, Y, B, A, Z, C, W: X, Y, Z and W are undone creations P owns, so hidden, and the
 * second A is a duplicate. P lists A, B and C.
 */
function cluttered(): Replica {
  const [r] = replicas([
    { name: "P" },
    { name: "A", parent: "P" },
    { name: "B", parent: "P" },
    { name: "C", parent: "P" },
    { name: "T" },
  ]);
  allocate(
    r!.store,
    nextCommandId(r!.store.doc),
    ["X", "Y", "Z", "W"].map((name) => child(name, "P", { listed: false })),
  );
  const list = listing(r!);
  list.clear();
  for (const [index, name] of ["X", "A", "Y", "B", "A", "Z", "C", "W"].entries()) {
    list.insert(index, id(name));
  }
  r!.store.doc.commit();
  return r!;
}

const listing = (r: Replica): LoroMovableList => r.store.doc.getMovableList(`list:${id("P")}`);
const names = (ids: readonly string[]) => ids.map((name) => id(name));

for (const [position, expected] of [
  [0, ["T", "A", "B", "C"]],
  [1, ["A", "T", "B", "C"]],
  [2, ["A", "B", "T", "C"]],
  [3, ["A", "B", "C", "T"]],
] as const) {
  test(`an insert at visible position ${position} lands there past hidden and duplicate entries`, () => {
    const r = cluttered();
    insertListing(r.store, id("P"), id("T"), entryIndexForInsert(r, id("P"), position));
    deepStrictEqual(listedNodes(r, id("P")), names(expected));
  });
}

for (const { label, target, position, visible, entries } of [
  {
    label: "backwards to the top",
    target: "C",
    position: 0,
    visible: ["C", "A", "B"],
    entries: ["X", "C", "A", "Y", "B", "A", "Z", "W"],
  },
  {
    label: "forwards past a hidden entry",
    target: "A",
    position: 1,
    visible: ["B", "A", "C"],
    entries: ["X", "Y", "B", "Z", "A", "C", "W"],
  },
  {
    label: "forwards to the end",
    target: "A",
    position: 2,
    visible: ["B", "C", "A"],
    entries: ["X", "Y", "B", "Z", "C", "W", "A"],
  },
]) {
  test(`a reorder ${label} lands at the visible position, directly before the entry of the occurrence that follows it`, () => {
    const r = cluttered();
    // The reorder's precondition: the target's other observed entries are deleted first.
    const list = listing(r);
    const all = listingEntries(r.store, id("P"));
    for (let index = all.length - 1; index > all.indexOf(id(target)); index--) {
      if (all[index] === id(target)) {
        list.delete(index, 1);
      }
    }
    list.move(
      listingEntries(r.store, id("P")).indexOf(id(target)),
      entryIndexForMove(r, id("P"), id(target), position),
    );
    deepStrictEqual([listedNodes(r, id("P")), listingEntries(r.store, id("P"))], [names(visible), names(entries)]);
  });
}
