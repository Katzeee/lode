// Purpose: Guards derived-id generations: a retired id is never reused, and replicas seeing the same generations converge on one new NodeId.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import { allocatedGenerations, metanodeId, nextDerivedId } from "./derived-id.ts";
import type { NodeId } from "./node-id.ts";
import { base, replica, sync, type Replica } from "./replicas.test-support.ts";

const create = (r: Replica, id: NodeId) =>
  allocate(r.store, nextCommandId(r.store.doc), [{ id, parent: "H" as NodeId, listed: false }]);

test("a new node in a role takes the next generation, and concurrent ones converge on it", () => {
  const snapshot = base([{ id: "H" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  const meta = metanodeId("H" as NodeId);
  create(a, nextDerivedId(a.store, meta));
  sync(a, b);
  const next = [a, b].map((r) => nextDerivedId(r.store, meta));
  deepStrictEqual(next, ["H:meta#1", "H:meta#1"], "the retired generation is not reused");
  [a, b].forEach((r, index) => create(r, next[index]!));
  sync(a, b);
  deepStrictEqual(allocatedGenerations(a.store, meta), ["H:meta", "H:meta#1"]);
  deepStrictEqual(
    [a.store.ownership.incarnationParents("H:meta#1" as NodeId).length, nextDerivedId(b.store, meta)],
    [2, "H:meta#2"],
  );
});
