import { describe, expect, it } from "vitest";

import {
  factTransactionId,
  frontierOf,
  makeFact,
  type ContributionFact,
  type Fact,
  type Mutation,
} from "../fact/index.js";
import { projectSnapshot } from "../../../tests/support/reconcile/projection.js";
import { deriveActivation, deriveSupport } from "./support.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const versions = { rulesVersion: "proposal-rules-5", schemaVersion: "lode-schema-19" } as const;

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

  it("activates every member of a Fact Transaction as one unit", () => {
    const parent = contribution(1, { kind: "node-create", nodeId: "parent" }, "proposal");
    const transactionId = factTransactionId("workspace", REPLICA, 2);
    const child = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      transaction: { transactionId, index: 0, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "child" },
      },
    }) as ContributionFact;
    const placement = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 3,
      observed: { [REPLICA]: 2 },
      lamport: 3,
      transaction: { transactionId, index: 1, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "child-original",
          nodeId: "child",
          parentNodeId: "parent",
          anchor: end,
        },
      },
    }) as ContributionFact;

    const origin = deriveActivation([parent, child, placement], "origin");
    const review = deriveActivation([parent, child, placement], "review");

    expect(origin.activeContributionIds.has(child.id)).toBe(false);
    expect(origin.activeContributionIds.has(placement.id)).toBe(false);
    expect(review.activeContributionIds.has(child.id)).toBe(true);
    expect(review.activeContributionIds.has(placement.id)).toBe(true);
  });

  it("represents transaction activation with linear support", () => {
    const size = 20;
    const transactionId = factTransactionId("workspace", REPLICA, 1);
    const members = Array.from(
      { length: size },
      (_, index) =>
        makeFact({
          workspaceId: "workspace",
          replicaId: REPLICA,
          sequence: index + 1,
          observed: index === 0 ? {} : { [REPLICA]: index },
          lamport: index + 1,
          transaction: { transactionId, index, size },
          body: {
            kind: "contribution",
            actorId: "actor",
            intent: "direct",
            mutation: { kind: "node-create", nodeId: `node-${index}` },
          },
        }) as ContributionFact,
    );

    const support = deriveSupport(members);
    expect(
      [...support.values()].reduce((total, dependencies) => total + dependencies.length, 0),
    ).toBe(size);
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
        parentNodeId: "workspace",
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

  it("an occurrence depends on the parent Node contribution", () => {
    const childNode = contribution(1, { kind: "node-create", nodeId: "child" });
    const parentNode = contribution(2, { kind: "node-create", nodeId: "parent" }, "proposal");
    const child = contribution(3, {
      kind: "occurrence-create",
      occurrenceId: "child-placement",
      nodeId: "child",
      parentNodeId: "parent",
      anchor: end,
    });
    const pending = [childNode, parentNode, child];
    const support = deriveSupport(pending);
    expect(support.get(child.id)).toContain(parentNode.id);
    expect(project(pending, "origin").occurrences["child-placement"]).toBeUndefined();
    expect(project(pending, "review").occurrences["child-placement"]?.parentNodeId).toBe("parent");

    const rejected = [...pending, resolution(4, [parentNode.id], "reject")];
    expect(project(rejected, "review").occurrences["child-placement"]).toBeUndefined();

    const accepted = [...pending, resolution(4, [parentNode.id], "accept")];
    expect(project(accepted, "origin").occurrences["child-placement"]?.parentNodeId).toBe("parent");
  });
});

function project(facts: readonly Fact[], view: "origin" | "review") {
  const workspace = makeFact({
    workspaceId: "workspace",
    replicaId: "zzzzzzzzzzzzzzzzzzzzzzzzzz",
    sequence: 1,
    observed: {},
    lamport: 1,
    body: {
      kind: "contribution",
      actorId: "workspace-genesis",
      intent: "direct",
      mutation: { kind: "node-create", nodeId: "workspace" },
    },
  });
  const projectedFacts = [workspace, ...facts];
  return projectSnapshot(
    "workspace",
    { facts: projectedFacts, frontier: frontierOf(projectedFacts) },
    view,
    versions,
  );
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
