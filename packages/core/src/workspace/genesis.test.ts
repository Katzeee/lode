// Purpose: Guards that replicas running genesis independently merge into one set of present system nodes.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { isPresent } from "../graph/presence.ts";
import { SYSTEM_ROLES } from "../graph/system-nodes.ts";
import { newDocId } from "../store/doc-id.ts";
import { Store } from "../store/store.ts";
import { genesis, readSystemNodes } from "./genesis.ts";

test("independent genesis of one document writes identical bytes and merges to one set", () => {
  const docId = newDocId();
  const a = genesis(docId);
  const b = genesis(docId);
  deepStrictEqual(a.export({ mode: "snapshot" }), b.export({ mode: "snapshot" }));

  a.import(b.export({ mode: "update" }));
  const store = new Store(a);
  const system = readSystemNodes(a);
  strictEqual(store.tree.getNodes().length, SYSTEM_ROLES.length);
  for (const role of SYSTEM_ROLES) {
    strictEqual(isPresent({ store, system }, system[role]), true, role);
  }
});
