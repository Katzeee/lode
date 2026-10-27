// Purpose: Guards command identity uniqueness when a peer reopens from a snapshot.

import { notStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { writeSupport } from "./records.ts";
import { base, command, node, replica } from "./replicas.test-support.ts";

test("a peer reopened from its snapshot never repeats a command id", () => {
  const a = replica(1n, base([{ id: "N" }]));
  const before = command(a, (id) => writeSupport(node(a, "N"), id));

  const reopened = replica(1n, a.store.doc.export({ mode: "snapshot" }));
  const after = command(reopened, (id) => writeSupport(node(reopened, "N"), id));

  notStrictEqual(after, before);
});
