// Purpose: Guards equal-value writes creating no operation and owner listings surviving refused cyclic moves.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { NodeId } from "./node-id.ts";
import { listedBy, writeListed, writeSupport } from "./records.ts";
import { base, command, node, replica, sync, type Replica } from "./replicas.test-support.ts";
import { parentIdOf } from "./store.ts";

test("rewriting a key's current value creates no operation", () => {
  const a = replica(1n, base([{ id: "N" }]));
  const id = command(a, (command) => writeSupport(node(a, "N"), command));
  const version = a.store.doc.oplogVersion().toJSON();

  writeSupport(node(a, "N"), id);
  a.store.doc.commit();

  deepStrictEqual(a.store.doc.oplogVersion().toJSON(), version);
});

/** Moves `id` under `to` and writes the destination's key, as Move does. */
function move(r: Replica, id: string, to: string, listed: boolean): void {
  command(r, () => {
    node(r, id).move(node(r, to));
    writeListed(node(r, id), to as NodeId, listed);
  });
}

const listedByOwner = (r: Replica, id: string) => {
  const owner = parentIdOf(node(r, id));
  return owner !== undefined && listedBy(node(r, id), owner);
};

for (const listed of [false, true]) {
  // Each move writes the opposite of the starting value, so a single shared flag reads wrong.
  const moved = !listed;
  for (const [peerA, peerB] of [
    [1n, 2n],
    [2n, 1n],
  ]) {
    test(`after a refused cyclic move each node reads its own owner's key (listed: ${listed}, A=${peerA})`, () => {
      const snapshot = base([{ id: "H" }, { id: "X", parent: "H", listed }, { id: "Y", parent: "H", listed }]);
      const a = replica(peerA!, snapshot);
      const b = replica(peerB!, snapshot);
      move(a, "X", "Y", moved);
      move(b, "Y", "X", moved);
      sync(a, b);

      const fellBack = ["X", "Y"].map((id) => parentIdOf(node(a, id)) === "H");
      strictEqual(fellBack.filter(Boolean).length, 1, "Loro refuses exactly one move");
      for (const r of [a, b]) {
        deepStrictEqual(
          ["X", "Y"].map((id) => listedByOwner(r, id)),
          fellBack.map((back) => (back ? listed : moved)),
        );
      }
    });
  }
}
