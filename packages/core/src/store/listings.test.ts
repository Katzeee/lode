// Purpose: Guards that reading the listing of an id this replica never allocated registers no root container.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { listingEntries } from "./listings.ts";
import type { NodeId } from "./node-id.ts";
import { base, replica } from "./replicas.test-support.ts";

test("reading the listing of an unallocated id registers no container", () => {
  const { store } = replica(1n, base([{ id: "P" }]));
  const before = store.doc.export({ mode: "snapshot" });

  deepStrictEqual(listingEntries(store, "never-allocated" as NodeId), []);
  deepStrictEqual(store.doc.export({ mode: "snapshot" }), before);
});
