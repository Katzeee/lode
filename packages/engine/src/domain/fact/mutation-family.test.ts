import { describe, expect, it } from "vitest";

import {
  isNodeMutation,
  isOccurrenceMutation,
  isSchemaMutation,
  isTextMutation,
  isValueMutation,
  type Mutation,
} from "./index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Mutation family", () => {
  it("classifies domain families without inferring them from naming conventions", () => {
    const mutations = {
      node: { kind: "node-delete", nodeId: "node" },
      occurrence: { kind: "occurrence-delete", occurrenceId: "occurrence" },
      schema: { kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end },
      text: {
        kind: "text-mark",
        nodeId: "node",
        atomIds: [],
        key: "emphasis",
        value: { kind: "set", value: true },
      },
      value: {
        kind: "value-unset",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "key",
      },
    } as const satisfies Readonly<Record<string, Mutation>>;

    expect(isNodeMutation(mutations.node)).toBe(true);
    expect(isNodeMutation(mutations.occurrence)).toBe(false);
    expect(isOccurrenceMutation(mutations.occurrence)).toBe(true);
    expect(isOccurrenceMutation(mutations.schema)).toBe(false);
    expect(isSchemaMutation(mutations.schema)).toBe(true);
    expect(isSchemaMutation(mutations.value)).toBe(false);
    expect(isTextMutation(mutations.text)).toBe(true);
    expect(isTextMutation(mutations.value)).toBe(false);
    expect(isValueMutation(mutations.value)).toBe(true);
    expect(isValueMutation(mutations.text)).toBe(false);
  });
});
