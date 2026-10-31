// Purpose: Guards that an undone creation reads as Trash content while another replica's support keeps it readable, that a node reading real hides its gated creation facts without clearing them, that concurrent incarnations of one NodeId read as one node, and that presence closes over every incarnation, ownership cycles included.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "../store/allocate.ts";
import { nextCommandId } from "../store/command-id.ts";
import { ALLOCATION, COMMAND } from "../store/origins.ts";
import {
  descriptionOf,
  kindOf,
  tupleDefinitionIdOf,
  writeDescription,
  writeReal,
  writeSupport,
} from "../store/records.ts";
import { Store } from "../store/store.ts";
import { child, command, id, replicas, type Replica } from "./graph.test-support.ts";
import { send, sync } from "../store/replicas.test-support.ts";
import { listedNodes, occurrences } from "./occurrences.ts";
import { descriptionRead, isPresent, kindRead, ownerOf, sourceRead, tupleDefinitionRead } from "./presence.ts";
import { nameString, writableName } from "./content.ts";

const created = () => child("R", "H", { kind: "tuple", tupleDefinitionId: id("D"), sourceId: id("S") });

const reads = (r: Replica) => ({
  present: isPresent(r, id("R")),
  owner: ownerOf(r, id("R")),
  kind: kindRead(r, id("R")),
  definition: tupleDefinitionRead(r, id("R")),
  description: descriptionRead(r, id("R")),
  source: sourceRead(r, id("R")),
  listedByHost: occurrences(r, id("H")).some((o) => o.node === id("R")),
});

test("an undone creation with no other support reads as owned by Trash, keeping its source", () => {
  const [a] = replicas([{ name: "H" }]);
  command(a!, [created()], () => writableName(a!, id("R")).insert(0, "typed"));
  // A copy's allocation writes its description in the excluded commit, so Undo keeps it stored.
  writeDescription(a!.store, id("R"), "note");
  a!.store.doc.commit({ origin: ALLOCATION });

  a!.undo.undo();
  deepStrictEqual(reads(a!), {
    present: false,
    owner: id("trash"),
    kind: undefined,
    definition: undefined,
    description: undefined,
    source: id("S"),
    listedByHost: false,
  });
  deepStrictEqual(nameString(a!, id("R")), "");

  a!.undo.redo();
  deepStrictEqual(reads(a!), {
    present: true,
    owner: id("H"),
    kind: "tuple",
    definition: id("D"),
    description: "note",
    source: id("S"),
    listedByHost: true,
  });
});

for (const receivedFirst of [true, false]) {
  test(`another replica's support keeps an undone creation readable (received before undo: ${receivedFirst})`, () => {
    const [a, b] = replicas([{ name: "H" }]);
    command(a!, [created()]);
    sync(a!, b!);
    command(b!, [child("C", "R")], (cmd) => writeSupport(b!.store, id("R"), cmd));
    if (receivedFirst) {
      sync(a!, b!);
    }
    a!.undo.undo();
    sync(a!, b!);

    for (const r of [a!, b!]) {
      deepStrictEqual(reads(r), {
        present: true,
        owner: id("H"),
        kind: "tuple",
        definition: id("D"),
        description: undefined,
        source: id("S"),
        listedByHost: true,
      });
      deepStrictEqual(occurrences(r, id("R")), [{ parent: id("R"), node: id("C"), link: "original" }]);
    }
  });
}

test("an edit of a created node's child keeps the creation readable after the creator's undo", () => {
  const [a, b] = replicas([{ name: "H" }]);
  command(a!, [created(), child("C", "R")]);
  sync(a!, b!);
  command(b!, [], (cmd) => {
    writableName(b!, id("C")).insert(0, "remote");
    writeSupport(b!.store, id("C"), cmd);
  });
  a!.undo.undo();
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(reads(r).listedByHost, true);
    deepStrictEqual(reads(r).source, id("S"));
    deepStrictEqual(
      occurrences(r, id("R")).map((o) => o.node),
      [id("C")],
    );
  }
});

test("a present node that reads real hides kind, definition and description, keeps them stored, and reads its source", () => {
  const [a, b] = replicas([{ name: "H" }]);
  command(a!, [created()], () => writeDescription(a!.store, id("R"), "note"));
  sync(a!, b!);
  command(b!, [], (cmd) => {
    writeReal(b!.store, id("R"), b!.store.doc.peerIdStr);
    writeSupport(b!.store, id("R"), cmd);
  });
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(reads(r), {
      present: true,
      owner: id("H"),
      kind: undefined,
      definition: undefined,
      description: undefined,
      source: id("S"),
      listedByHost: true,
    });
    deepStrictEqual(
      [kindOf(r.store, id("R")), tupleDefinitionIdOf(r.store, id("R")), descriptionOf(r.store, id("R"))],
      ["tuple", id("D"), "note"],
      "the stored values stay",
    );
  }
  b!.undo.undo();
  sync(a!, b!);
  deepStrictEqual(
    [kindRead(a!, id("R")), tupleDefinitionRead(a!, id("R")), descriptionRead(a!, id("R"))],
    ["tuple", id("D"), "note"],
  );
});

const D = id("D");
/** Allocates `name` under `parent` with no support, as a creation whose command was undone. */
const unsupported = (r: Replica, name: string, parent: string) =>
  allocate(r.store, nextCommandId(r.store.doc), [child(name, parent)]);
const plain = (r: Replica, write: () => void) => {
  write();
  r.store.doc.commit({ origin: COMMAND });
};

test("one NodeId created concurrently reads as one node, listed once, the same on both replicas", () => {
  const [a, b] = replicas([{ name: "I" }]);
  for (const r of [a!, b!]) {
    command(r, [child("D", "I", { sourceId: id("S") })]);
  }
  sync(a!, b!);
  for (const r of [a!, b!]) {
    deepStrictEqual(
      [
        r.store.ownership.incarnationParents(D).length,
        isPresent(r, D),
        ownerOf(r, D),
        sourceRead(r, D),
        occurrences(r, id("I")),
      ],
      [2, true, id("I"), id("S"), [{ parent: id("I"), node: D, link: "original" }]],
    );
  }
});

for (const bFirst of [true, false]) {
  test(`the creator's undo keeps a node another replica edited and supports (other's edit merged first: ${bFirst})`, () => {
    const [a, b] = replicas([{ name: "I" }]);
    command(a!, [child("D", "I")]);
    sync(a!, b!);
    const edit = () =>
      command(b!, [], (cmd) => {
        writableName(b!, D).insert(0, "B edit");
        writeSupport(b!.store, D, cmd);
      });
    if (bFirst) {
      edit();
      sync(a!, b!);
      a!.undo.undo();
    } else {
      a!.undo.undo();
      edit();
    }
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual(
        [isPresent(r, D), ownerOf(r, D), listedNodes(r, id("I")), nameString(r, D)],
        [true, id("I"), [D], "B edit"],
      );
    }
  });
}

test("a node both replicas created stays present on the other's support, until both undo", () => {
  const [a, b] = replicas([{ name: "I" }]);
  for (const r of [a!, b!]) {
    command(r, [child("D", "I")]);
  }
  sync(a!, b!);
  a!.undo.undo();
  sync(a!, b!);
  deepStrictEqual([isPresent(a!, D), ownerOf(a!, D), listedNodes(a!, id("I"))], [true, id("I"), [D]]);
  b!.undo.undo();
  sync(a!, b!);
  deepStrictEqual([isPresent(a!, D), ownerOf(a!, D), listedNodes(a!, id("I"))], [false, id("trash"), []]);
});

test("a supported node under a parent's stale incarnation keeps the parent present when the canonical one arrives", () => {
  const [a, b] = replicas([{ name: "H" }]);
  unsupported(a!, "P", "H");
  unsupported(b!, "P", "H");
  command(b!, [child("W", "P")]);
  sync(a!, b!);
  for (const r of [a!, b!]) {
    deepStrictEqual([r.store.ownership.physicalOwner(id("W")), isPresent(r, id("P"))], [id("P"), true]);
  }
});

test("a late canonical incarnation moves which owner a supported node keeps present (Lode's policy for concurrent states)", () => {
  const [a, b] = replicas([{ name: "H" }]);
  unsupported(a!, "P", "H");
  sync(a!, b!);
  unsupported(b!, "R", "H");
  plain(b!, () => {
    allocate(b!.store, nextCommandId(b!.store.doc), [child("X", "R")]);
    writeSupport(b!.store, id("X"), nextCommandId(b!.store.doc));
  });
  const before = [isPresent(b!, id("P")), isPresent(b!, id("R"))];
  unsupported(a!, "X", "P");
  sync(a!, b!);
  deepStrictEqual(
    [before, [isPresent(b!, id("P")), isPresent(b!, id("R"))]],
    [
      [false, true],
      [true, false],
    ],
  );
});

for (const aFirst of [true, false]) {
  for (const support of ["none", "member", "owned descendant"] as const) {
    test(`an ownership cycle across incarnations reads stably (support: ${support}, A merged first: ${aFirst})`, () => {
      // A creates X; B creates X and Y; only A sees B's creations; A moves every X it knows under Y while
      // B moves Y under its own X. A's X is canonical, so X and Y end up owning each other.
      const [a, b] = replicas([{ name: "I" }]);
      unsupported(a!, "X", "I");
      unsupported(b!, "X", "I");
      unsupported(b!, "Y", "I");
      send(b!, a!);
      plain(a!, () => a!.store.ownership.moveOwner(id("X"), id("Y")));
      plain(b!, () => b!.store.ownership.moveOwner(id("Y"), id("X")));
      if (support === "member") {
        plain(a!, () => writeSupport(a!.store, id("X"), nextCommandId(a!.store.doc)));
      } else if (support === "owned descendant") {
        unsupported(a!, "Z", "X");
        plain(a!, () => writeSupport(a!.store, id("Z"), nextCommandId(a!.store.doc)));
      }
      if (aFirst) {
        send(a!, b!);
        send(b!, a!);
      } else {
        send(b!, a!);
        send(a!, b!);
      }
      const reopened = { ...a!, store: new Store(a!.store.doc.fork()) };
      const present = support !== "none";
      for (const r of [a!, b!, reopened]) {
        deepStrictEqual(
          [r.store.ownership.physicalOwner(id("X")), r.store.ownership.physicalOwner(id("Y"))],
          [id("Y"), id("X")],
          "the cycle formed",
        );
        deepStrictEqual(
          [isPresent(r, id("X")), isPresent(r, id("Y")), ownerOf(r, id("X")), ownerOf(r, id("Y"))],
          present ? [true, true, id("Y"), id("X")] : [false, false, id("trash"), id("trash")],
        );
      }
    });
  }
}

test("a command's uncommitted support and owner change read at once", () => {
  const [a] = replicas([{ name: "H" }, { name: "Q" }]);
  unsupported(a!, "N", "H");
  strictEqual(isPresent(a!, id("N")), false);
  writeSupport(a!.store, id("N"), nextCommandId(a!.store.doc));
  a!.store.ownership.moveOwner(id("N"), id("Q"));
  deepStrictEqual(
    [isPresent(a!, id("N")), ownerOf(a!, id("N")), a!.store.doc.getPendingTxnLength() > 0],
    [true, id("Q"), true],
  );
});
