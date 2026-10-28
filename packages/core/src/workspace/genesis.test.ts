// Purpose: Guards that replicas running genesis independently merge into one set of present system nodes with their roles.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { isPresent } from "../graph/presence.ts";
import { SYSTEM_ROLES } from "../graph/system-nodes.ts";
import { newDocId } from "../store/doc-id.ts";
import { idOf } from "../store/records.ts";
import { Store } from "../store/store.ts";
import { isFieldDefinition, isSupertag } from "../tags/roles.ts";
import { genesis, readSystemNodes } from "./genesis.ts";

test("independent genesis of one document writes identical bytes and merges to one set", () => {
  const docId = newDocId();
  const a = genesis(docId);
  const b = genesis(docId);
  deepStrictEqual(a.export({ mode: "snapshot" }), b.export({ mode: "snapshot" }));

  a.import(b.export({ mode: "update" }));
  const store = new Store(a);
  const system = readSystemNodes(a);
  const graph = { store, system };
  for (const role of SYSTEM_ROLES) {
    strictEqual(isPresent(graph, system[role]), true, role);
  }
  // Leaves carry no NodeId; every node with one must hold a distinct identity, one per system role.
  const ids = store.tree.getNodes().flatMap((node) => idOf(node) ?? []);
  strictEqual(new Set(ids).size, ids.length, "no domain NodeId is stored twice");
  for (const role of SYSTEM_ROLES) {
    strictEqual(ids.filter((each) => each === system[role]).length, 1, role);
  }
  deepStrictEqual(
    ["supertag", "fieldDefinition", "metaTemplate", "options", "tags"].map((role) => {
      const node = system[role as keyof typeof system];
      return [isSupertag(graph, node), isFieldDefinition(graph, node)];
    }),
    [
      [true, false],
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ],
  );
});
