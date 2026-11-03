// Purpose: Guards one command as one undo step across its Loro items: per-direction counts after remote edits empty items, whole-command eviction, throw rollback, and Trash occurrences of what an undone command created.

import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { nameString, writableName } from "../graph/content.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { listedNodes } from "../graph/occurrences.ts";
import { isPresent, ownerOf } from "../graph/presence.ts";
import type { Writer } from "../operations/writer.ts";
import { listingEntries } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { replica, send, sync } from "../store/replicas.test-support.ts";
import { HISTORY } from "../store/origins.ts";
import { nameText } from "../store/text.ts";
import { history, run } from "./history.test-support.ts";

const D = id("D");
const E = id("E");
const H = id("H");
const I = id("I");
const P = id("P");
const R = id("R");
const X = id("X");
const trash = id("trash");

const append = (r: Replica, node: NodeId, text: string) => {
  const name = writableName(r, node);
  name.insert(name.length, text);
};
const edit = (r: Replica, node: NodeId, text: string) => (writer: Writer) => {
  writer.touch(node);
  append(r, node, text);
};

test("a command with ordinary writes, a name seed and two allocations is one step", () => {
  const [r] = replicas([{ name: "H" }]);
  const read = () => [nameString(r!, H), nameString(r!, D), nameString(r!, E), listedNodes(r!, H), listedNodes(r!, D)];
  const before = read();
  run(r!, (writer) => {
    edit(r!, H, "h")(writer);
    writer.create([child("D", "H", { nameBase: [{ insert: "Todo" }] })]);
    edit(r!, D, "!")(writer);
    writer.create([child("E", "D")]);
    edit(r!, E, "e")(writer);
  });
  const done = read();
  deepStrictEqual(done, ["h", "Todo!", "e", [D], [E]]);
  history(r!).undo();
  deepStrictEqual([read(), history(r!).canUndo()], [before, false]);
  history(r!).redo();
  deepStrictEqual(read(), done);
});

test("Redo of a command whose item a remote edit emptied leaves the next command alone and redoable", () => {
  const [a, b] = replicas([{ name: "I" }, { name: "P" }]);
  run(a!, (writer) => writer.create([child("D", "I", { nameBase: [{ insert: "Todo" }] })]));
  // C1 spans two items: its support, then (after the excluded seed) the "!" a remote edit removes.
  run(a!, edit(a!, D, "!"));
  run(a!, edit(a!, P, "c"));
  sync(a!, b!);
  run(b!, (writer) => {
    writer.touch(D);
    writableName(b!, D).delete(4, 1);
  });
  sync(a!, b!);
  history(a!).undo();
  history(a!).undo();
  history(a!).redo();
  deepStrictEqual([nameString(a!, P), history(a!).canRedo()], ["", true]);
  history(a!).redo();
  strictEqual(nameString(a!, P), "c");
});

test("Undo of a command whose redo item a remote edit emptied leaves the older command alone", () => {
  const [a, b] = replicas([{ name: "I" }]);
  run(a!, (writer) => writer.create([child("D", "I", { nameBase: [{ insert: "Todox" }] })]));
  run(a!, edit(a!, I, "older"));
  // C1 spans two items: its support, then (after the excluded seed) a deletion a remote edit repeats.
  run(a!, (writer) => {
    writer.touch(D);
    writableName(a!, D).delete(4, 1);
  });
  history(a!).undo();
  sync(a!, b!);
  run(b!, (writer) => {
    writer.touch(D);
    writableName(b!, D).delete(4, 1);
  });
  sync(a!, b!);
  history(a!).redo();
  history(a!).undo();
  deepStrictEqual([nameString(a!, I), history(a!).canUndo()], ["older", true]);
});

/** Three commands of two items each, with room for two: the oldest is evicted. */
function fullStack() {
  const [r] = replicas([{ name: "H" }]);
  history(r!, 4);
  for (const name of ["O1", "O2", "O3"]) {
    run(r!, (writer) => {
      writer.create([child(name, "H")]);
      append(r!, id(name), "o");
    });
  }
  return r!;
}

for (const allocating of [false, true]) {
  test(`with a full stack, a command throwing ${allocating ? "after" : "before"} an allocation reverts whole and earlier commands still undo whole`, () => {
    const r = fullStack();
    throws(
      () =>
        run(r, (writer) => {
          edit(r, H, "before")(writer);
          if (allocating) {
            writer.create([child("X", "H")]);
            append(r, X, "after");
          }
          throw new Error("fail");
        }),
      /fail/,
    );
    deepStrictEqual(
      [nameString(r, H), isPresent(r, X), listedNodes(r, trash), history(r).canRedo()],
      ["", false, allocating ? [X] : [], false],
    );
    strictEqual(r.store.has(X), allocating, "allocation is not undone");
    history(r).undo();
    history(r).undo();
    deepStrictEqual(
      [history(r).canUndo(), ...["O1", "O2", "O3"].map((name) => [isPresent(r, id(name)), nameString(r, id(name))])],
      [false, [true, "o"], [false, ""], [false, ""]],
    );
  });
}

test("an overflowing command drops only whole old commands, and an oversized one goes with them", () => {
  const r = fullStack();
  // Three items: the room for two-item commands now holds only this one.
  run(r, (writer) => {
    edit(r, H, "h")(writer);
    writer.create([child("X", "H")]);
    writer.create([child("Y", "H")]);
    append(r, id("Y"), "y");
  });
  history(r).undo();
  deepStrictEqual(
    [history(r).canUndo(), nameString(r, H), isPresent(r, X), nameString(r, id("O2")), nameString(r, id("O3"))],
    [false, "", false, "o", "o"],
  );
  // Five items exceed the capacity: kept while running, then dropped with everything below.
  run(r, (writer) => {
    for (const name of ["V1", "V2", "V3", "V4"]) {
      writer.create([child(name, "H")]);
    }
    append(r, id("V4"), "v");
  });
  run(r, edit(r, H, "after"));
  history(r).undo();
  deepStrictEqual([history(r).canUndo(), nameString(r, H), isPresent(r, id("V1"))], [false, "", true]);
});

test("Undo lists created nodes once at the top of Trash in creation order, and Redo keeps them", () => {
  const [r] = replicas([{ name: "H" }, { name: "Z", parent: "trash" }]);
  run(r!, (writer) => writer.create([child("D", "H"), child("E", "H")]));
  history(r!).undo();
  deepStrictEqual(listedNodes(r!, trash), [D, E, id("Z")]);
  history(r!).redo();
  deepStrictEqual(
    [listedNodes(r!, H), listedNodes(r!, trash)],
    [
      [D, E],
      [D, E, id("Z")],
    ],
  );
  history(r!).undo();
  deepStrictEqual(listingEntries(r!.store, trash), [D, E, id("Z")]);
});

for (const first of ["creator", "editor"] as const) {
  test(`concurrent withdrawal of the last support, ${first} imported first, leaves Trash listing the node`, () => {
    const [a, b] = replicas([{ name: "H" }]);
    run(a!, (writer) => writer.create([child("R", "H")]));
    sync(a!, b!);
    run(b!, edit(b!, R, "b"));
    sync(a!, b!);
    history(a!).undo();
    history(b!).undo();
    const [from, to] = first === "creator" ? [a!, b!] : [b!, a!];
    send(from, to);
    send(to, from);
    for (const r of [a!, b!]) {
      deepStrictEqual([isPresent(r, R), ownerOf(r, R), listedNodes(r, trash)], [false, trash, [R]]);
    }
  });
}

test("an entry whose Undo pushed nothing leaves no Redo, and the adjacent created list stays with its own command", () => {
  const [a, b] = replicas([{ name: "H" }, { name: "P" }]);
  run(a!, (writer) => writer.create([child("X", "H")]));
  // A direct write with no support: its only item is removed by a remote edit.
  run(a!, () => nameText(a!.store, P).insert(0, "z"));
  sync(a!, b!);
  nameText(b!.store, P).delete(0, 1);
  b!.store.doc.commit();
  sync(a!, b!);
  history(a!).undo();
  deepStrictEqual([history(a!).canRedo(), listedNodes(a!, trash)], [false, []]);
  history(a!).undo();
  deepStrictEqual(listedNodes(a!, trash), [X]);
  history(a!).redo();
  deepStrictEqual([isPresent(a!, X), listedNodes(a!, trash)], [true, [X]]);
});

test("an evicted command's created list goes with it: Undo trashes only what the kept commands created", () => {
  const [r] = replicas([{ name: "H" }]);
  // Two items each, room for two commands.
  history(r!, 4);
  for (const name of ["D", "E", "R"]) {
    run(r!, (writer) => writer.create([child(name, "H")]));
  }
  while (history(r!).undo()) {
    // Undo every kept command.
  }
  deepStrictEqual([listedNodes(r!, H), listedNodes(r!, trash)], [[D], [E, R]]);
});

test("a history operation called inside a command, over pending writes, or from a commit's subscriber is refused", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, (writer) => writer.create([child("D", "H")]));
  throws(() => run(r!, () => history(r!).undo()), /runs alone/);
  nameText(r!.store, H).insert(0, "pending");
  throws(() => history(r!).undo(), /runs alone/);
  throws(() => history(r!).redo(), /runs alone/);
  throws(() => run(r!, () => {}), /runs alone/);
  deepStrictEqual([history(r!).canUndo(), isPresent(r!, D)], [true, true]);
  r!.store.doc.commit({ origin: HISTORY });

  const refused: unknown[] = [];
  const unsubscribe = r!.store.doc.subscribe((batch) => {
    if (batch.origin === HISTORY) {
      try {
        run(r!, edit(r!, H, "reentered"));
      } catch (error) {
        refused.push(error);
      }
    }
  });
  history(r!).undo();
  unsubscribe();
  deepStrictEqual(
    [refused.length, nameString(r!, H), isPresent(r!, D), history(r!).canRedo()],
    [1, "pending", false, true],
  );
  history(r!).redo();
  deepStrictEqual([isPresent(r!, D), history(r!).canUndo()], [true, true]);
});

test("a command whose allocation is refused leaves no identity behind, and a retry and earlier commands still work", () => {
  const [r] = replicas([{ name: "H" }]);
  run(r!, edit(r!, H, "older"));
  throws(
    () => run(r!, (writer) => writer.create([child("X", "H"), child("Y", "Z"), child("Z", "H")])),
    /not allocated before it/,
  );
  const reopened = replica(9n, r!.store.doc.export({ mode: "snapshot" }));
  deepStrictEqual([r!.store.has(X), reopened.store.has(X), r!.store.doc.getPendingTxnLength()], [false, false, 0]);
  run(r!, (writer) => writer.create([child("X", "H")]));
  history(r!).undo();
  history(r!).undo();
  deepStrictEqual([isPresent(r!, X), nameString(r!, H), history(r!).canUndo()], [false, "", false]);
});
