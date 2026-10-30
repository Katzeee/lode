// Purpose: Guards that rewriting a key's current value creates no Loro operation.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { writeSupport } from "./records.ts";
import { base, command, replica } from "./replicas.test-support.ts";
import type { NodeId } from "./node-id.ts";

test("rewriting a key's current value creates no operation", () => {
  const a = replica(1n, base([{ id: "N" }]));
  const id = command(a, (command) => writeSupport(a.store, "N" as NodeId, command));
  const version = a.store.doc.oplogVersion().toJSON();

  writeSupport(a.store, "N" as NodeId, id);
  a.store.doc.commit();

  deepStrictEqual(a.store.doc.oplogVersion().toJSON(), version);
});
