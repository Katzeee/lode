// Purpose: Guards that an undone creation reads as Trash content while another replica's support keeps it readable.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { nameOf, writeSupport } from "../store/records.ts";
import { child, command, id, node, replicas, sync, type Replica } from "./graph.test-support.ts";
import { occurrences } from "./occurrences.ts";
import { isPresent, kindRead, ownerOf, sourceRead, tupleDefinitionRead } from "./presence.ts";

const created = () => child("R", "H", { kind: "tuple", tupleDefinitionId: id("D"), sourceId: id("S") });

const reads = (r: Replica) => ({
  present: isPresent(r, id("R")),
  owner: ownerOf(r, id("R")),
  kind: kindRead(r, id("R")),
  definition: tupleDefinitionRead(r, id("R")),
  source: sourceRead(r, id("R")),
  listedByHost: occurrences(r, id("H")).some((o) => o.node === id("R")),
});

test("an undone creation with no other support reads as owned by Trash, keeping its source", () => {
  const [a] = replicas([{ name: "H" }]);
  command(a!, [created()], () => nameOf(node(a!, "R")).insert(0, "typed"));

  a!.undo.undo();
  deepStrictEqual(reads(a!), {
    present: false,
    owner: id("trash"),
    kind: undefined,
    definition: undefined,
    source: id("S"),
    listedByHost: false,
  });
  deepStrictEqual(nameOf(node(a!, "R")).toString(), "");

  a!.undo.redo();
  deepStrictEqual(reads(a!), {
    present: true,
    owner: id("H"),
    kind: "tuple",
    definition: id("D"),
    source: id("S"),
    listedByHost: true,
  });
});

for (const receivedFirst of [true, false]) {
  test(`another replica's support keeps an undone creation readable (received before undo: ${receivedFirst})`, () => {
    const [a, b] = replicas([{ name: "H" }]);
    command(a!, [created()]);
    sync(a!, b!);
    command(b!, [child("C", "R")], (cmd) => writeSupport(node(b!, "R"), cmd));
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
    nameOf(node(b!, "C")).insert(0, "remote");
    writeSupport(node(b!, "C"), cmd);
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
