// Purpose: Guards a copy's effective name: it reads its base until the first edit seeds it, the edit undoes back to the base, an undone creation reads no name, another replica's edit on the seed survives, and a node that reads real reads its own text and is never seeded.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { Delta } from "loro-crdt";
import type { CommandId } from "../store/command-id.ts";
import { isNameSeeded, writeReal, writeSupport } from "../store/records.ts";
import { nameText } from "../store/text.ts";
import { nameOf, nameString, writableName } from "./content.ts";
import { child, command, id, replicas, type Replica } from "./graph.test-support.ts";
import { sync } from "../store/replicas.test-support.ts";
import { inlineNodes } from "./inline.ts";

const D = id("D");
const base: Delta<string>[] = [{ insert: "To", attributes: { bold: true } }, { insert: "do" }];
const copy = (extra = {}) => child("D", "I", { sourceId: id("S"), nameBase: base, ...extra });
const append = (r: Replica, text: string) => {
  const name = writableName(r, D);
  name.insert(name.length, text);
};
const undoAll = (r: Replica) => {
  while (r.undo.canUndo()) {
    r.undo.undo();
  }
};
const redoAll = (r: Replica) => {
  while (r.undo.canRedo()) {
    r.undo.redo();
  }
};

test("a copy reads its base until edited; undoing the edit returns the base, undoing the creation clears it", () => {
  const [r] = replicas([{ name: "I" }]);
  command(r!, [copy()]);
  deepStrictEqual(nameOf(r!, D), base);
  command(r!, [], (cmd) => {
    append(r!, "!");
    writeSupport(r!.store, D, cmd);
  });
  deepStrictEqual(nameOf(r!, D), [{ insert: "To", attributes: { bold: true } }, { insert: "do!" }]);

  r!.undo.undo();
  deepStrictEqual(nameOf(r!, D), base, "the seed stays");
  r!.undo.undo();
  deepStrictEqual(nameOf(r!, D), [], "an undone creation has no name");
  redoAll(r!);
  deepStrictEqual(nameString(r!, D), "Todo!");
});

test("a copy created and edited in one command reads no name once undone, and the edit on Redo", () => {
  const [r] = replicas([{ name: "I" }]);
  command(r!, [copy()], () => append(r!, "!"));
  deepStrictEqual(nameString(r!, D), "Todo!");
  undoAll(r!);
  deepStrictEqual(nameOf(r!, D), []);
  redoAll(r!);
  deepStrictEqual(nameString(r!, D), "Todo!");
});

test("a base's inline mention stops counting once the copy's creation is undone", () => {
  const [r] = replicas([{ name: "I" }, { name: "K" }]);
  command(r!, [copy({ nameBase: [{ insert: "￼", attributes: { ref: id("K") } }] })]);
  deepStrictEqual(inlineNodes(r!, D), [id("K")]);
  r!.undo.undo();
  deepStrictEqual(inlineNodes(r!, D), []);
});

test("another replica's edit on the seed survives the first editor's undo", () => {
  const [a, b] = replicas([{ name: "I" }]);
  command(a!, [copy()]);
  command(a!, [], (cmd) => {
    append(a!, " A");
    writeSupport(a!.store, D, cmd);
  });
  sync(a!, b!);
  command(b!, [], (cmd) => {
    append(b!, " B");
    writeSupport(b!.store, D, cmd);
  });
  sync(a!, b!);
  a!.undo.undo();
  sync(a!, b!);
  for (const r of [a!, b!]) {
    deepStrictEqual(nameString(r, D), "Todo B");
  }
});

test("two first edits of one copy at once both seed it, doubling the base (Lode's policy for concurrent states)", () => {
  const [a, b] = replicas([{ name: "I" }]);
  command(a!, [copy()]);
  sync(a!, b!);
  for (const [r, text] of [
    [a!, "A"],
    [b!, "B"],
  ] as const) {
    command(r, [], (cmd) => {
      append(r, text);
      writeSupport(r.store, D, cmd);
    });
  }
  sync(a!, b!);
  deepStrictEqual(nameString(a!, D), nameString(b!, D));
  deepStrictEqual(nameString(a!, D).length, "TodoATodoB".length);
});

/**
 * Make-real's writes on D as direct key writes: under Trash, this peer's `real|` key, support, its
 * observed name characters deleted; then `text` typed through `writableName`.
 */
const makeRealAndType = (r: Replica, text: string) =>
  command(r, [], (cmd: CommandId) => {
    r.store.ownership.moveOwner(D, id("trash"));
    writeReal(r.store, D, r.store.doc.peerIdStr);
    writeSupport(r.store, D, cmd);
    const name = nameText(r.store, D);
    name.delete(0, name.length);
    writableName(r, D).insert(0, text);
  });

test("a copy made real reads its own text on every replica, never its base or the base's marks, and is not seeded", () => {
  const [a, b] = replicas([{ name: "I" }, { name: "K" }]);
  command(a!, [copy({ nameBase: [...base, { insert: "￼", attributes: { ref: id("K") } }] })]);
  a!.undo.undo();
  sync(a!, b!);
  makeRealAndType(b!, "new");
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual([nameOf(r, D), inlineNodes(r, D), isNameSeeded(r.store, D)], [[{ insert: "new" }], [], false]);
  }
});

for (const seeded of [false, true]) {
  test(`once every real key is withdrawn, the creator's Redo reads ${seeded ? "its seeded text" : "the base"} again`, () => {
    const [a, b] = replicas([{ name: "I" }]);
    command(a!, [copy()]);
    if (seeded) {
      command(a!, [], (cmd) => {
        append(a!, "!");
        writeSupport(a!.store, D, cmd);
      });
    }
    undoAll(a!);
    sync(a!, b!);
    makeRealAndType(b!, "B");
    sync(a!, b!);
    redoAll(a!);
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual(nameString(r, D), seeded ? "B!" : "B", "B's real key keeps the name on the text");
    }

    b!.undo.undo();
    sync(a!, b!);
    for (const r of [a!, b!]) {
      deepStrictEqual(nameOf(r, D), seeded ? [{ insert: "To", attributes: { bold: true } }, { insert: "do!" }] : base);
    }
  });
}
