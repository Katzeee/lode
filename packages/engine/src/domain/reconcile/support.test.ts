import { describe, expect, it } from "vitest";

import {
  frontierOf,
  makeFact,
  type ContributionFact,
  type Fact,
  type Mutation,
} from "../fact/index.js";
import { projectSnapshot } from "./projection.js";
import { deriveActivation, deriveSupport } from "./support.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;

describe("semantic support policy", () => {
  it("DEP-1 support is derived only by owner counterfactual policy", () => {
    const node = contribution(1, { kind: "node-create", nodeId: "node" }, "proposal");
    const firstText = contribution(
      2,
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "a" },
      "direct",
    );
    const secondText = contribution(
      3,
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "b" },
      "direct",
    );
    const support = deriveSupport([node, firstText, secondText]);

    expect(support.get(firstText.id)).toEqual([node.id]);
    expect(support.get(secondText.id)).toEqual([node.id]);
    expect(support.get(secondText.id)).not.toContain(firstText.id);
  });

  it("DEP-2 inactive support closes dependents without mutating facts", () => {
    const node = contribution(1, { kind: "node-create", nodeId: "node" }, "proposal");
    const text = contribution(
      2,
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "dependent" },
      "direct",
    );
    const activation = deriveActivation([node, text], "origin");
    expect(activation.activeContributionIds.has(text.id)).toBe(false);
    expect(text.body.intent).toBe("direct");
  });

  it("duplicate live creates do not replace the effective existence support", () => {
    const directCreate = contribution(1, { kind: "node-create", nodeId: "node" });
    const duplicateProposal = contribution(2, { kind: "node-create", nodeId: "node" }, "proposal");
    const text = contribution(3, {
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "X",
    });

    const support = deriveSupport([directCreate, duplicateProposal, text]);
    const origin = deriveActivation([directCreate, duplicateProposal, text], "origin");

    expect(support.get(text.id)).toEqual([directCreate.id]);
    expect(origin.activeContributionIds.has(text.id)).toBe(true);
  });

  it("a rejected first Proposal create yields existence support to an independent Direct create", () => {
    const proposalCreate = contribution(1, { kind: "node-create", nodeId: "node" }, "proposal");
    const directCreate = contribution(2, { kind: "node-create", nodeId: "node" });
    const text = contribution(3, {
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "X",
    });
    const rejection = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 4,
      observed: { [REPLICA]: 3 },
      lamport: 4,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision: "reject",
        proposalContributionIds: [proposalCreate.id],
      },
    });

    const origin = deriveActivation([proposalCreate, directCreate, text, rejection], "origin");
    expect(origin.supportByContribution.get(text.id)).toEqual([directCreate.id]);
    expect(origin.activeContributionIds.has(text.id)).toBe(true);
  });

  it("Create + existence dependency", () => {
    const node = contribution(1, { kind: "node-create", nodeId: "node" }, "proposal");
    const occurrence = contribution(
      2,
      {
        kind: "occurrence-create",
        occurrenceId: "occurrence",
        nodeId: "node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      "direct",
    );
    const pending = [node, occurrence];
    expect(deriveSupport(pending).get(occurrence.id)).toEqual([node.id]);
    expect(project(pending, "origin").occurrences.occurrence).toBeUndefined();
    expect(project(pending, "review").occurrences.occurrence).toBeDefined();

    const accepted = [...pending, resolution(3, [node.id], "accept")];
    expect(project(accepted, "origin").occurrences.occurrence).toBeDefined();
    expect(project(accepted, "review").occurrences.occurrence).toBeDefined();

    const rejected = [...pending, resolution(3, [node.id], "reject")];
    expect(project(rejected, "origin").occurrences.occurrence).toBeUndefined();
    expect(project(rejected, "review").occurrences.occurrence).toBeUndefined();
    expect(rejected).toHaveLength(3);
    expect(occurrence.body.intent).toBe("direct");
  });

  it("Cascade 与 rehome", () => {
    const node = contribution(1, { kind: "node-create", nodeId: "node" });
    const cascadeParent = contribution(
      2,
      {
        kind: "occurrence-create",
        occurrenceId: "cascade-parent",
        nodeId: "node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      "proposal",
    );
    const rehomeParent = contribution(
      3,
      {
        kind: "occurrence-create",
        occurrenceId: "rehome-parent",
        nodeId: "node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      "proposal",
    );
    const cascadeChild = contribution(4, {
      kind: "occurrence-create",
      occurrenceId: "cascade-child",
      nodeId: "node",
      parentOccurrenceId: "cascade-parent",
      parentPolicy: "cascade",
      anchor: end,
    });
    const rehomeChild = contribution(5, {
      kind: "occurrence-create",
      occurrenceId: "rehome-child",
      nodeId: "node",
      parentOccurrenceId: "rehome-parent",
      parentPolicy: "rehome",
      anchor: end,
    });
    const pending = [node, cascadeParent, rehomeParent, cascadeChild, rehomeChild];
    const support = deriveSupport(pending);
    expect(support.get(cascadeChild.id)).toContain(cascadeParent.id);
    expect(support.get(rehomeChild.id)).not.toContain(rehomeParent.id);
    expect(project(pending, "origin").occurrences["cascade-child"]).toBeUndefined();
    expect(project(pending, "origin").occurrences["rehome-child"]?.parentOccurrenceId).toBeNull();
    expect(project(pending, "review").occurrences["cascade-child"]?.parentOccurrenceId).toBe(
      "cascade-parent",
    );

    const rejected = [...pending, resolution(6, [cascadeParent.id, rehomeParent.id], "reject")];
    const rejectedProjection = project(rejected, "review");
    expect(rejectedProjection.occurrences["cascade-child"]).toBeUndefined();
    expect(rejectedProjection.occurrences["rehome-child"]?.parentOccurrenceId).toBeNull();

    const accepted = [...pending, resolution(6, [cascadeParent.id, rehomeParent.id], "accept")];
    expect(project(accepted, "origin").occurrences["cascade-child"]?.parentOccurrenceId).toBe(
      "cascade-parent",
    );
    expect(project(accepted, "origin").occurrences["rehome-child"]?.parentOccurrenceId).toBe(
      "rehome-parent",
    );
  });
});

function project(facts: readonly Fact[], view: "origin" | "review") {
  return projectSnapshot("workspace", { facts, frontier: frontierOf(facts) }, view, versions);
}

function resolution(
  sequence: number,
  proposalContributionIds: readonly string[],
  decision: "accept" | "reject",
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: {
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision,
      proposalContributionIds,
    },
  });
}

function contribution(
  sequence: number,
  mutation: Mutation,
  intent: "direct" | "proposal" = "direct",
): ContributionFact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: { kind: "contribution", actorId: "actor", intent, mutation },
  }) as ContributionFact;
}
