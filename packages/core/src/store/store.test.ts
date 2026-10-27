// Purpose: Guards ownerless node identity through undo, redo and reopening, and NodeId lookup after remote import.

import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { base, command, node, replica, send } from "./replicas.test-support.ts";
import { parentIdOf } from "./store.ts";

test("an ownerless node survives undo, redo and reopening as a root", () => {
  const a = replica(1n, base([{ id: "H" }, { id: "N", parent: "H" }]));
  command(a, () => node(a, "N").move(undefined));
  strictEqual(parentIdOf(node(a, "N")), undefined);

  a.undo.undo();
  strictEqual(parentIdOf(node(a, "N")), "H");
  a.undo.redo();
  strictEqual(parentIdOf(node(a, "N")), undefined);

  const reopened = replica(2n, a.store.doc.export({ mode: "snapshot" }));
  strictEqual(parentIdOf(node(reopened, "N")), undefined);
});

test("a node allocated on one replica is found by NodeId on another", () => {
  const snapshot = base([{ id: "H" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  allocate(a.store, nextCommandId(a.store.doc), [{ id: "N" as NodeId, parent: "H" as NodeId, listed: true }]);
  send(a, b);
  strictEqual(parentIdOf(node(b, "N")), "H");
});
