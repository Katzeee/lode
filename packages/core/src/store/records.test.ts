// Purpose: Guards that rewriting a key's current value creates no Loro operation.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { writeSupport } from "./records.ts";
import { base, command, node, replica } from "./replicas.test-support.ts";

test("rewriting a key's current value creates no operation", () => {
  const a = replica(1n, base([{ id: "N" }]));
  const id = command(a, (command) => writeSupport(node(a, "N"), command));
  const version = a.store.doc.oplogVersion().toJSON();

  writeSupport(node(a, "N"), id);
  a.store.doc.commit();

  deepStrictEqual(a.store.doc.oplogVersion().toJSON(), version);
});
