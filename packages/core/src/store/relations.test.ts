// Purpose: Guards relation keys against concurrent removal and sequential command undo and redo.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { NodeId } from "./node-id.ts";
import { deleteRelationRecords, relationRecords, writeRelation, type Relation } from "./relations.ts";
import { base, command, node, replica, send, sync, type Replica } from "./replicas.test-support.ts";

const META: Relation = { type: "meta", target: "M" as NodeId };

const metaTargets = (r: Replica) =>
  relationRecords(node(r, "H")).map((record) => (record.type === "meta" ? record.target : undefined));

for (const [peerA, peerB] of [
  [1n, 2n],
  [2n, 1n],
]) {
  for (const removerFirst of [true, false]) {
    test(`a removal of observed keys keeps a concurrent fresh key (A=${peerA}, remover merged first: ${removerFirst})`, () => {
      const snapshot = base([{ id: "H" }]);
      const a = replica(peerA!, snapshot);
      const b = replica(peerB!, snapshot);
      command(b, (id) => writeRelation(b.store, node(b, "H"), META, id));
      sync(a, b);

      command(a, () => deleteRelationRecords(a.store, node(a, "H"), relationRecords(node(a, "H"))));
      command(b, (id) => writeRelation(b.store, node(b, "H"), META, id));
      if (removerFirst) {
        send(a, b);
        send(b, a);
      } else {
        send(b, a);
        send(a, b);
      }

      deepStrictEqual(metaTargets(a), ["M"]);
      deepStrictEqual(metaTargets(b), ["M"]);
    });
  }
}

test("one peer's sequential commands leave one key, and undo and redo step through them", () => {
  const a = replica(1n, base([{ id: "H" }]));
  const first = command(a, (id) => writeRelation(a.store, node(a, "H"), META, id));
  const second = command(a, (id) => writeRelation(a.store, node(a, "H"), META, id));
  const commands = () => relationRecords(node(a, "H")).map((record) => record.command);

  deepStrictEqual(commands(), [second]);
  a.undo.undo();
  deepStrictEqual(commands(), [first]);
  a.undo.redo();
  deepStrictEqual(commands(), [second]);
});
