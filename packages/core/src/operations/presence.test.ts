// Purpose: Guards make-real against states only other replicas produce: a late Trash entry, a child promoted away, a remote first-edit seed, the creation's relations, and an allocation under an undone node.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { effectiveHolder } from "../graph/associations.ts";
import { nameString, writableName } from "../graph/content.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { effectiveMetanode } from "../graph/metanode.ts";
import { listedNodes, occurrences } from "../graph/occurrences.ts";
import { isPresent, kindRead, ownerOf, sourceRead } from "../graph/presence.ts";
import { history, run } from "../history/history.test-support.ts";
import { insertListing, listingEntries } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { readsReal } from "../store/records.ts";
import { sync } from "../store/replicas.test-support.ts";
import type { Writer } from "./writer.ts";

const D = id("D");
const M = id("M");
const N = id("N");
const C = id("C");
const H = id("H");
const K = id("K");
const Q = id("Q");
const S = id("S");

const edit = (r: Replica, node: NodeId, text: string) => (writer: Writer) => {
  writer.touch(node);
  const name = writableName(r, node);
  name.insert(name.length, text);
};

test("a Trash entry arriving after make-real inserted its own reads once, as the original", () => {
  const [a, b] = replicas([{ name: "H" }]);
  run(a!, (writer) => writer.create([child("M", "H")]));
  sync(a!, b!);
  const updates: Uint8Array[] = [];
  const unsubscribe = a!.store.doc.subscribeLocalUpdates((update) => void updates.push(update));
  history(a!).undo();
  unsubscribe();
  // The Undo arrives without the history commit that lists M in Trash.
  b!.store.doc.import(updates[0]!);
  strictEqual(isPresent(b!, M), false);
  strictEqual(listingEntries(b!.store, id("trash")).includes(M), false);

  run(b!, edit(b!, M, "late"));
  for (const update of updates.slice(1)) {
    b!.store.doc.import(update);
  }
  sync(a!, b!);
  for (const r of [a!, b!]) {
    strictEqual(listingEntries(r.store, id("trash")).filter((entry) => entry === M).length, 2);
    deepStrictEqual(
      occurrences(r, id("trash")).filter((o) => o.node === M),
      [{ parent: id("trash"), node: M, link: "original" }],
    );
    strictEqual(nameString(r, M), "late");
  }
});

test("a child another replica promoted away does not revive under its made-real creation parent", () => {
  const [a, b] = replicas([{ name: "I" }, { name: "Q" }]);
  run(a!, (writer) => writer.create([child("N", "I"), child("C", "N")]));
  sync(a!, b!);
  run(b!, (writer) => {
    writer.touch(C);
    b!.store.ownership.moveOwner(C, Q);
    writer.touch(Q);
    insertListing(b!.store, Q, C);
  });
  sync(a!, b!);
  history(a!).undo();
  run(a!, edit(a!, N, "x"));
  sync(a!, b!);
  for (const r of [a!, b!]) {
    deepStrictEqual([listedNodes(r, N), ownerOf(r, C), listedNodes(r, Q)], [[], Q, [C]]);
  }
});

test("make-real racing another replica's first-edit seed keeps that edit after its Undo", () => {
  const [a, b] = replicas([{ name: "I" }]);
  run(a!, (writer) => writer.create([child("D", "I", { sourceId: S, nameBase: [{ insert: "Todo" }] })]));
  sync(a!, b!);
  history(a!).undo();
  run(a!, edit(a!, D, "x"));
  run(b!, edit(b!, D, "!"));
  sync(a!, b!);
  history(a!).undo();
  sync(a!, b!);
  deepStrictEqual([nameString(a!, D), nameString(b!, D)], ["Todo!", "Todo!"]);
});

test("making a node real does not revive the relations its creation established", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, (writer) =>
    writer.create(
      [child("M", "H", { listed: false, kind: "metanode" }), child("K", "H", { listed: false })],
      [
        { host: H, relation: { type: "meta", target: M } },
        { host: H, relation: { type: "assoc", subject: S, holder: K } },
      ],
    ),
  );
  deepStrictEqual([effectiveMetanode(r!, H), effectiveHolder(r!, H, S)], [M, K]);
  history(r!).undo();
  run(r!, (writer) => {
    edit(r!, M, "m")(writer);
    edit(r!, K, "k")(writer);
  });
  deepStrictEqual(
    [isPresent(r!, M), isPresent(r!, K), effectiveMetanode(r!, H), effectiveHolder(r!, H, S)],
    [true, true, undefined, undefined],
  );
});

test("an allocation under an undone node makes the parent real before the new node makes it present", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, (writer) => writer.create([child("N", "H", { kind: "tagDef", sourceId: S })]));
  history(r!).undo();
  run(r!, (writer) => writer.create([child("X", "N")]));
  deepStrictEqual(
    [
      ownerOf(r!, N),
      kindRead(r!, N),
      sourceRead(r!, N),
      readsReal(r!.store, N),
      listedNodes(r!, H),
      listedNodes(r!, N),
    ],
    [id("trash"), undefined, S, true, [], [id("X")]],
  );
});
