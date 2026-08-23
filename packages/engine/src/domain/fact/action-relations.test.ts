import { describe, expect, it } from "vitest";

import { actionRelations, templateInstanceNodeId, type AuthoredAction } from "./index.js";

describe("action relations", () => {
  it("captures only the authored template detachment identities", () => {
    const action: AuthoredAction = {
      kind: "template-node-detach",
      ownerNodeId: "owner",
      templateNodeId: "template",
      instanceNodeId: templateInstanceNodeId("owner", "template"),
      instanceOccurrenceId: "instance-occurrence",
      anchor: {
        after: "after",
        before: "before",
        affinity: "after",
        fallback: "end",
      },
    };

    const relations = actionRelations(action);

    expect(new Set(relations.nodeIds)).toEqual(
      new Set(["owner", "template", templateInstanceNodeId("owner", "template")]),
    );
    expect(new Set(relations.occurrenceIds)).toEqual(new Set(["instance-occurrence", "after", "before"]));
    expect(relations.supertagIds).toEqual([]);
    expect(relations.instanceSupertagIds).toEqual([]);
  });

  it("keeps text atom actions as typed relations", () => {
    const textRelations = actionRelations({
      kind: "rich-text-mark",
      nodeId: "text",
      atomIds: ["g1/workspace/101/1/actions/0#0", "g1/workspace/101/2/actions/0#3"],
      key: "bold",
      value: { kind: "set", value: true },
    });

    expect(textRelations.actionIds).toEqual(["g1/workspace/101/1/actions/0", "g1/workspace/101/2/actions/0"]);
  });
});
