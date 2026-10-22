import { expect, it } from "vitest";
import {
  decodeEngineQuery,
  decodeEngineQueryResult,
  encodeEngineQuery,
  encodeEngineQueryResult,
} from "./protocol-codec.js";
import type { EngineQueryResult } from "./contract.js";

it("transports authored placement order independently of effective child order", () => {
  const query = {
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "authoredChildOccurrences",
  } as const;
  const result: EngineQueryResult<typeof query> = {
    status: "ok",
    value: {
      identity: {
        workspaceNodeId: "workspace",
        generationId: "generation",
        frontier: { replica: 1 },
        rulesVersion: "rules",
        schemaVersion: "schema",
      },
      perspective: "origin",
      section: "authoredChildOccurrences",
      next: null,
      authoredChildOccurrences: { owner: ["ordinary-sibling", "materialized-source"] },
    },
  };
  expect(decodeEngineQuery(encodeEngineQuery(query))).toEqual(query);
  expect(decodeEngineQueryResult(encodeEngineQueryResult(query, result), query)).toEqual(result);
});
