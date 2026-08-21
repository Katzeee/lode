import { describe, expect, it } from "vitest";

import { makeFact, type Mutation } from "../../fact/index.js";
import { base, end, REPLICA, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { fullSurface } from "../../../../tests/support/reconcile/full-surface-test-fixture.js";
import { supertagApplicationIdentity } from "../../../../tests/support/reconcile/supertag-application-test-helpers.js";
import { rebuildGeneration } from "../reconcile.js";
import type { Projection } from "../projection-types.js";
import { selectEligibleDirectTail } from "./index.js";

describe("Direct Projection tail policy", () => {
  it("delegates Projection prerequisites to each Mutation family", () => {
    const facts = fullSurface("direct");
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).origin;
    const application = supertagApplicationIdentity("node", "supertag");
    const eligible = [
      { kind: "node-delete", nodeId: "node" },
      { kind: "occurrence-delete", occurrenceId: "occurrence" },
      {
        kind: "supertag-remove",
        hostNodeId: "node",
        supertagId: "supertag",
        applicationNodeId: application.applicationNodeId,
        applicationOccurrenceId: application.applicationOccurrenceId,
        relationDefinitionOccurrenceId: application.relationDefinitionOccurrenceId,
        definitionOccurrenceId: application.definitionOccurrenceId,
        detachedValueNodeId: `${application.applicationNodeId}-detached-value`,
        detachedValueOccurrenceId: `${application.applicationNodeId}-detached-value-occurrence`,
      },
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "x" },
    ] as const satisfies readonly Mutation[];

    expect(eligible.map((mutation) => isEligible(projection, mutation))).toEqual(eligible.map(() => true));
    expect(
      isEligible(projection, {
        kind: "intrinsic-node-type-declare",
        nodeId: "node",
        intrinsicNodeType: "calendar",
      }),
    ).toBe(false);
    expect(
      isEligible(projection, {
        kind: "supertag-apply",
        hostNodeId: "node",
        supertagId: "missing-supertag",
        applicationNodeId: "missing-application",
        applicationOccurrenceId: "missing-application-occurrence",
        relationDefinitionOccurrenceId: "missing-relation-definition-occurrence",
        definitionOccurrenceId: "missing-definition-occurrence",
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
          detachmentContributionIds: [],
        },
      ],
    };
    const mutation = {
      kind: "template-node-detach",
      ownerNodeId: "node",
      templateNodeId: "template",
      instanceNodeId: "instance",
      instanceOccurrenceId: "instance-occurrence",
      anchor: end,
    } as const satisfies Mutation;

    expect(isEligible(projection, mutation)).toBe(false);
    expect(isEligible(linked, mutation)).toBe(true);
  });

  it("selects only a neutral-order all-Direct Fact suffix", () => {
    const facts = base();
    const before = facts.snapshot();
    const projection = rebuildGeneration("workspace", before, versions).origin;
    const direct = facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "x",
    });
    const directSnapshot = facts.snapshot();

    expect(selectEligibleDirectTail(projection, directSnapshot.facts, [direct])).toEqual([direct]);

    const proposal = facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    const proposalSnapshot = facts.snapshot();
    expect(selectEligibleDirectTail(projection, proposalSnapshot.facts, [proposal])).toBeNull();
    expect(selectEligibleDirectTail(projection, proposalSnapshot.facts, [direct])).toBeNull();
  });
});

function isEligible(projection: Projection, mutation: Mutation): boolean {
  const fact = makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence: 1,
    observed: {},
    lamport: 1,
    body: { kind: "contribution", actorId: "actor", intent: "direct", mutation },
  });
  return selectEligibleDirectTail(projection, [fact], [fact]) !== null;
}
