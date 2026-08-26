import { describe, expect, it } from "vitest";
import {
  factActions,
  graphActionBody,
  makeFact,
  type FactAction,
  type FactFrontier,
  type GraphAction,
  type ReplicaId,
} from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";

const atEnd = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("causal collection", () => {
  it("combines observed removal, restoration, and concurrent registers", () => {
    const addition = recorded(
      {
        kind: "template-field-add",
        supertagId: "tag",
        fieldDefinition: { kind: "existing", fieldDefinitionId: "field" },
        anchor: atEnd,
      },
      { replicaId: "1", sequence: 1 },
    );
    const removal = recorded(
      { kind: "template-field-remove", supertagId: "tag", fieldDefinitionId: "field" },
      { replicaId: "1", sequence: 2, observed: { "1": 1 } },
    );
    const removedState = causalCollectionStates([addition, removal], "template-field")[0];
    expect(removedState?.removed).toBe(true);

    const restoration = recorded(
      { kind: "template-field-restore", templateFieldId: addition.id },
      { replicaId: "1", sequence: 3, observed: { "1": 2 } },
    );
    const normal = recorded(
      { kind: "template-field-visibility-set", templateFieldId: addition.id, visibility: "normal" },
      { replicaId: "2", sequence: 1, observed: { "1": 1 } },
    );
    const pinned = recorded(
      { kind: "template-field-visibility-set", templateFieldId: addition.id, visibility: "pinned" },
      { replicaId: "3", sequence: 1, observed: { "1": 1 } },
    );
    const restoredState = causalCollectionStates([addition, removal, restoration, normal, pinned], "template-field")[0];

    expect(restoredState?.removed).toBe(false);
    expect(restoredState?.registers.get("visibility")).toMatchObject({
      values: ["normal", "pinned"],
      conflicted: true,
    });
    expect(restoredState?.registers.get("visibility")?.candidates.map((candidate) => candidate.id)).toEqual([
      normal.id,
      pinned.id,
    ]);
  });
});

function recorded(
  action: GraphAction,
  coordinate: Readonly<{ replicaId: ReplicaId; sequence: number; observed?: FactFrontier }>,
): FactAction {
  const fact = makeFact({
    workspaceId: "workspace",
    replicaId: coordinate.replicaId,
    sequence: coordinate.sequence,
    observed: coordinate.observed ?? {},
    lamport: coordinate.sequence,
    body: graphActionBody("actor", "direct", [action]),
  });
  const result = factActions(fact)[0];
  if (result === undefined) {
    throw new Error("Fixture does not contain a Fact Action");
  }
  return result;
}
