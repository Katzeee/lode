// Purpose: Guards holder assignment and removal: a transfer from Trash keeps the holder's other listings and Undo restores both pairs, a pair's holder is replaced, a re-set of the same pair re-asserts it against a concurrent removal, dissociation keeps the host's listing as a reference, and a replaced pair stays replaced when a record hidden at the setter's write becomes live again.

import { deepStrictEqual, notDeepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { effectiveHolder, effectivePair, liveHolderRecords } from "../graph/associations.ts";
import { nameString, writableName } from "../graph/content.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { lists, occurrences } from "../graph/occurrences.ts";
import { ownerOf } from "../graph/presence.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing } from "../store/listings.ts";
import { relationRecords, writeRelation } from "../store/relations.ts";
import { sync } from "../store/replicas.test-support.ts";
import { removeAssociatedDataFor, setAssociatedDataFor } from "./associations.ts";

const H = id("H");
const I = id("I");
const K = id("K");
const P = id("P");
const R = id("R");
const S = id("S");
const trash = id("trash");

/** Host R associates holder K, owned and listed by Trash, with subject S; P lists K too. */
function fixture(): Replica {
  const [r] = replicas([{ name: "R" }, { name: "I" }, { name: "S" }, { name: "P" }, { name: "K", parent: "trash" }]);
  run(r!, (writer) => {
    writer.touch(R);
    writeRelation(r!.store, R, { type: "assoc", subject: S, holder: K }, writer.command);
    writer.touch(P);
    insertListing(r!.store, P, K);
  });
  return r!;
}

test("a holder transferred from Trash leaves Trash, keeps its other listing, and loses its old pair; Undo restores both pairs", () => {
  const r = fixture();
  run(r, (writer) => setAssociatedDataFor(writer, I, S, K));
  deepStrictEqual([ownerOf(r, K), lists(r, trash, K), lists(r, P, K), lists(r, I, K)], [I, false, true, false]);
  deepStrictEqual(
    [effectivePair(r, K), effectiveHolder(r, R, S), liveHolderRecords(r, K).length],
    [{ host: I, subject: S }, undefined, 1],
  );

  history(r).undo();
  deepStrictEqual(
    [effectivePair(r, K), effectiveHolder(r, I, S), ownerOf(r, K), lists(r, trash, K)],
    [{ host: R, subject: S }, undefined, trash, true],
  );
});

test("assigning a pair a new holder replaces its old holder", () => {
  const r = fixture();
  run(r, (writer) => writer.create([child("K2", "R", { listed: false })]));
  run(r, (writer) => setAssociatedDataFor(writer, R, S, id("K2")));
  deepStrictEqual([effectiveHolder(r, R, S), effectivePair(r, K)], [id("K2"), undefined]);
});

test("re-setting the current pair writes a fresh key, which a concurrent removal of the older key leaves", () => {
  const [a, b] = replicas([{ name: "H" }, { name: "S" }, { name: "K", parent: "H", listed: false }]);
  run(a!, (writer) => setAssociatedDataFor(writer, H, S, K));
  sync(a!, b!);
  const older = relationRecords(a!.store, H).map((record) => record.key);
  run(a!, (writer) => setAssociatedDataFor(writer, H, S, K));
  const fresh = relationRecords(a!.store, H).map((record) => record.key);
  strictEqual(fresh.length, 1);
  notDeepStrictEqual(fresh, older);

  run(b!, (writer) => removeAssociatedDataFor(writer, H, S));
  sync(a!, b!);
  for (const r of [a!, b!]) {
    strictEqual(effectiveHolder(r, H, S), K);
  }
});

for (const listed of [false, true]) {
  test(`dissociating trashes the holder the host owns and keeps the host's listing as a reference (listed: ${listed})`, () => {
    const [r] = replicas([{ name: "H" }, { name: "S" }, { name: "K", parent: "H", listed }]);
    run(r!, (writer) => setAssociatedDataFor(writer, H, S, K));
    run(r!, (writer) => removeAssociatedDataFor(writer, H, S));
    deepStrictEqual(
      [ownerOf(r!, K), occurrences(r!, trash)[0]?.node, effectiveHolder(r!, H, S), occurrences(r!, H)],
      [trash, K, undefined, listed ? [{ parent: H, node: K, link: "reference" }] : []],
    );
  });
}

for (const peers of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`a replaced holder whose record was not live stays replaced once a late edit brings it back (peers ${peers.join(", ")})`, () => {
    const [a, b] = replicas([{ name: "H" }, { name: "S" }], peers);
    run(a!, (writer) =>
      writer.create(
        [child("K1", "H", { listed: false })],
        [{ host: H, relation: { type: "assoc", subject: S, holder: id("K1") } }],
      ),
    );
    sync(a!, b!);
    history(a!).undo();
    run(a!, (writer) => {
      writer.create([child("K2", "H", { listed: false })]);
      setAssociatedDataFor(writer, H, S, id("K2"));
    });
    run(b!, (writer) => {
      writer.touch(id("K1"));
      writableName(b!, id("K1")).insert(0, "remote");
    });
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual(
        [effectiveHolder(r, H, S), effectivePair(r, id("K1")), nameString(r, id("K1"))],
        [id("K2"), undefined, "remote"],
      );
    }
    history(a!).undo();
    sync(a!, b!);
    deepStrictEqual(effectiveHolder(a!, H, S), id("K1"));
  });

  test(`a holder transferred away from a host its own move leaves not present keeps its new pair after the host's Redo (peers ${peers.join(", ")})`, () => {
    const [a, b] = replicas([{ name: "O" }, { name: "Z" }, { name: "S" }], peers);
    run(a!, (writer) =>
      writer.create(
        [child("H", "O"), child("K", "H", { listed: false })],
        [{ host: H, relation: { type: "assoc", subject: S, holder: K } }],
      ),
    );
    sync(a!, b!);
    run(b!, (writer) => writer.touch(K));
    history(a!).undo();
    sync(a!, b!);
    run(b!, (writer) => setAssociatedDataFor(writer, id("Z"), S, K));
    sync(a!, b!);
    history(a!).redo();
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual([effectivePair(r, K), effectiveHolder(r, H, S)], [{ host: id("Z"), subject: S }, undefined]);
    }
  });
}
