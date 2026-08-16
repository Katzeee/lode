import { describe, expect, it } from "vitest";

import { isNodeMutation, isOccurrenceMutation, isSupertagMutation, isTextMutation, type Mutation } from "./index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Mutation family", () => {
  it("classifies domain families without inferring them from naming conventions", () => {
    const mutations = {
      node: { kind: "node-delete", nodeId: "node" },
      occurrence: { kind: "occurrence-delete", occurrenceId: "occurrence" },
      supertag: { kind: "supertag-apply", nodeId: "node", supertagId: "supertag", anchor: end },
      text: {
        kind: "text-mark",
        nodeId: "node",
        atomIds: [],
        key: "emphasis",
        value: { kind: "set", value: true },
      },
    } as const satisfies Readonly<Record<string, Mutation>>;

    expect(isNodeMutation(mutations.node)).toBe(true);
    expect(isNodeMutation(mutations.occurrence)).toBe(false);
    expect(isOccurrenceMutation(mutations.occurrence)).toBe(true);
    expect(isOccurrenceMutation(mutations.supertag)).toBe(false);
    expect(isSupertagMutation(mutations.supertag)).toBe(true);
    expect(isSupertagMutation(mutations.text)).toBe(false);
    expect(isTextMutation(mutations.text)).toBe(true);
    expect(isTextMutation(mutations.node)).toBe(false);
  });
});
