import { describe, expect, it } from "vitest";

import { makeFact, type GraphAction } from "../../fact/index.js";
import { base, end, REPLICA, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { fullSurface } from "../../../../tests/support/reconcile/full-surface-test-fixture.js";
import { rebuildGeneration } from "../reconcile.js";
import type { Projection } from "../projection-types.js";
import { selectEligibleDirectTail } from "./index.js";

describe("Direct Projection tail policy", () => {
  it("delegates Projection prerequisites to each GraphAction family", () => {
    const facts = fullSurface("direct");
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).origin;
    const eligible = [
      { kind: "node-trash", nodeId: "node" },
      { kind: "placement-remove", placementId: "occurrence" },
      {
        kind: "supertag-membership-remove",
        hostNodeId: "node",
        supertagId: "supertag",
      },
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "x" },
    ] as const satisfies readonly GraphAction[];

    expect(eligible.map((authoredAction) => isEligible(projection, authoredAction))).toEqual(eligible.map(() => true));
    expect(
      isEligible(projection, {
        kind: "node-create",
        nodeId: "node",
        ownerNodeId: "workspace",
        originalPlacement: null,
        intrinsicNodeType: "calendar",
      }),
    ).toBe(false);
    expect(
      isEligible(projection, {
        kind: "supertag-application-add",
        hostNodeId: "node",
        supertagId: "missing-supertag",
        anchor: end,
      }),
    ).toBe(false);
  });

  it("admits Template detachment only for an existing linked instance", () => {
    const facts = base();
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).origin;
    const linked: Projection = {
      ...projection,
      templateNodeInstances: [
        {
          ownerNodeId: "node",
          templateNodeId: "template",
          instanceNodeId: "instance",
          instanceOccurrenceId: "instance-occurrence",
          state: "linked",
          sources: [],
          detachmentActionIds: [],
        },
      ],
    };
    const authoredAction = {
      kind: "template-node-detach",
      ownerNodeId: "node",
      templateNodeId: "template",
      instanceNodeId: "instance",
      instanceOccurrenceId: "instance-occurrence",
      anchor: end,
    } as const satisfies GraphAction;

    expect(isEligible(projection, authoredAction)).toBe(false);
    expect(isEligible(linked, authoredAction)).toBe(true);
  });

  it("selects only a neutral-order all-Direct Fact suffix", () => {
    const facts = base();
    const before = facts.snapshot();
    const projection = rebuildGeneration("workspace", before, versions).origin;
    const direct = facts.add({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "x",
    });
    const directSnapshot = facts.snapshot();

    const directFact = directSnapshot.facts.find((fact) => fact.id === direct.factId)!;
    expect(selectEligibleDirectTail(projection, directSnapshot.facts, [directFact])).toEqual([direct]);

    const proposal = facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    const proposalSnapshot = facts.snapshot();
    const proposalFact = proposalSnapshot.facts.find((fact) => fact.id === proposal.factId)!;
    expect(selectEligibleDirectTail(projection, proposalSnapshot.facts, [proposalFact])).toBeNull();
    expect(selectEligibleDirectTail(projection, proposalSnapshot.facts, [directFact])).toBeNull();
  });
});

function isEligible(projection: Projection, authoredAction: GraphAction): boolean {
  const fact = makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence: 1,
    observed: {},
    lamport: 1,
    body: { kind: "action", actorId: "actor", intent: "direct", actions: [authoredAction] },
  });
  return selectEligibleDirectTail(projection, [fact], [fact]) !== null;
}
