import { describe, expect, it } from "vitest";

import {
  END_SEQUENCE_ANCHOR as end,
  factActionsFromFacts,
  factActions,
  factActionId,
  graphActionBody,
  makeFact,
  type Fact,
  type FactActionId,
  type FactId,
  type GraphAction,
} from "../fact/index.js";
import { frontierOf } from "../fact/frontier.js";
import { projectSnapshot } from "../../../tests/support/reconcile/projection.js";
import { deriveActivation, deriveSupport } from "./support.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../reconcile/index.js";

const REPLICA = "101";

describe("semantic support policy", () => {
  it("DEP-1 support is derived only by owner counterfactual policy", () => {
    const node = actionFact(
      1,
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const firstText = actionFact(
      2,
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "a" },
      "direct",
    );
    const secondText = actionFact(
      3,
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "b" },
      "direct",
    );
    const support = deriveSupport(factActionsFromFacts([node, firstText, secondText]));

    expect(support.get(actionId(firstText))).toEqual([actionId(node)]);
    expect(support.get(actionId(secondText))).toEqual([actionId(node)]);
    expect(support.get(actionId(secondText))).not.toContain(actionId(firstText));
  });

  it("DEP-2 inactive support closes dependents", () => {
    const node = actionFact(
      1,
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const text = actionFact(
      2,
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "dependent" },
      "direct",
    );
    const activation = deriveActivation([node, text], "origin");
    expect(activation.activeActionIds.has(actionId(text))).toBe(false);
  });

  it("activates every member of a Fact Transaction as one unit", () => {
    const parent = actionFact(
      1,
      { kind: "node-create", nodeId: "parent", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const edit = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      body: {
        kind: "action",
        actorId: "actor",
        intent: "direct",
        actions: [
          { kind: "node-create", nodeId: "child", ownerNodeId: "workspace", originalPlacement: null },
          {
            kind: "placement-create",
            placementId: "child-original",
            nodeId: "child",
            parentNodeId: "parent",
            anchor: end,
          },
        ],
      },
    });
    const [child, placement] = factActions(edit);
    if (!child || !placement) {
      throw new Error("Expected both Action Facts");
    }

    const origin = deriveActivation([parent, edit], "origin");
    const review = deriveActivation([parent, edit], "review");

    expect(origin.activeActionIds.has(child.id)).toBe(false);
    expect(origin.activeActionIds.has(placement.id)).toBe(false);
    expect(review.activeActionIds.has(child.id)).toBe(true);
    expect(review.activeActionIds.has(placement.id)).toBe(true);
  });

  it("duplicate live creates do not replace the effective existence support", () => {
    const directCreate = actionFact(1, {
      kind: "node-create",
      nodeId: "node",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    const duplicateProposal = actionFact(
      2,
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const text = actionFact(3, {
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "X",
    });

    const support = deriveSupport(factActionsFromFacts([directCreate, duplicateProposal, text]));
    const origin = deriveActivation([directCreate, duplicateProposal, text], "origin");

    expect(support.get(actionId(text))).toEqual([actionId(directCreate)]);
    expect(origin.activeActionIds.has(actionId(text))).toBe(true);
  });

  it("a rejected first Proposal create yields existence support to an independent Direct create", () => {
    const proposalCreate = actionFact(
      1,
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const text = actionFact(2, {
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "X",
    });
    const directCreate = actionFact(3, {
      kind: "node-create",
      nodeId: "node",
      ownerNodeId: "workspace",
      originalPlacement: null,
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
        proposalFactIds: [proposalCreate.id],
      },
    });

    const origin = deriveActivation([proposalCreate, directCreate, text, rejection], "origin");
    expect(origin.supportByAction.get(actionId(text))).toEqual([actionId(directCreate)]);
    expect(origin.activeActionIds.has(actionId(text))).toBe(true);
  });

  it("recovers an earlier Placement consumer through a later independent creator", () => {
    const node = actionFact(1, {
      kind: "node-create",
      nodeId: "node",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    const proposalCreate = actionFact(
      2,
      {
        kind: "placement-create",
        placementId: "placement",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
      "proposal",
    );
    const move = actionFact(3, {
      kind: "placement-move",
      placementId: "placement",
      parentNodeId: "workspace",
      anchor: end,
    });
    const directCreate = actionFact(4, {
      kind: "placement-create",
      placementId: "placement",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    const rejection = resolution(5, [proposalCreate.id], "reject");

    const origin = deriveActivation([node, proposalCreate, move, directCreate, rejection], "origin");
    expect(origin.supportByAction.get(actionId(move))).toContain(actionId(directCreate));
    expect(origin.activeActionIds.has(actionId(move))).toBe(true);
  });

  it("recovers earlier Inline Reference and Alias consumers through later independent producers", () => {
    const nodes = ["host", "target", "alias"].map((nodeId, index) =>
      actionFact(index + 1, { kind: "node-create", nodeId, ownerNodeId: "workspace", originalPlacement: null }),
    );
    const proposalReference = actionFact(
      4,
      {
        kind: "inline-reference-create",
        inlineReferenceId: "reference",
        hostNodeId: "host",
        targetNodeId: "target",
        anchor: end,
      },
      "proposal",
    );
    const proposalAlias = actionFact(
      5,
      { kind: "inline-alias-attach", inlineReferenceId: "reference", aliasNodeId: "alias" },
      "proposal",
    );
    const detach = actionFact(6, {
      kind: "inline-alias-detach",
      inlineReferenceId: "reference",
      aliasNodeId: "alias",
    });
    const directReference = actionFact(7, {
      kind: "inline-reference-create",
      inlineReferenceId: "reference",
      hostNodeId: "host",
      targetNodeId: "target",
      anchor: end,
    });
    const directAlias = actionFact(8, {
      kind: "inline-alias-attach",
      inlineReferenceId: "reference",
      aliasNodeId: "alias",
    });
    const rejection = resolution(9, [proposalReference.id, proposalAlias.id], "reject");

    const origin = deriveActivation(
      [...nodes, proposalReference, proposalAlias, detach, directReference, directAlias, rejection],
      "origin",
    );
    expect(origin.supportByAction.get(actionId(proposalAlias))).toContain(actionId(directReference));
    expect(origin.supportByAction.get(actionId(detach))).toContain(actionId(directAlias));
    expect(origin.activeActionIds.has(actionId(detach))).toBe(true);
  });

  it("Create + existence dependency", () => {
    const node = actionFact(
      1,
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const occurrence = actionFact(
      2,
      {
        kind: "placement-create",
        placementId: "occurrence",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
      "direct",
    );
    const pending = [node, occurrence];
    expect(deriveSupport(factActionsFromFacts(pending)).get(actionId(occurrence))).toEqual([actionId(node)]);
    expect(project(pending, "origin").occurrences.occurrence).toBeUndefined();
    expect(project(pending, "review").occurrences.occurrence).toBeDefined();

    const accepted = [...pending, resolution(3, [node.id], "accept")];
    expect(project(accepted, "origin").occurrences.occurrence).toBeDefined();
    expect(project(accepted, "review").occurrences.occurrence).toBeDefined();

    const rejected = [...pending, resolution(3, [node.id], "reject")];
    expect(project(rejected, "origin").occurrences.occurrence).toBeUndefined();
    expect(project(rejected, "review").occurrences.occurrence).toBeUndefined();
  });

  it("derives empty support for bootstrap and terminal Actions", () => {
    const bootstrap = actionFact(1, { kind: "workspace-bootstrap", workspaceNodeId: "workspace" });
    const terminal = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      body: {
        kind: "action",
        actorId: "actor",
        intent: "direct",
        actions: [{ kind: "node-deletion-finalize", nodeId: "node" }],
      },
    });

    const support = deriveSupport(factActionsFromFacts([bootstrap, terminal]));

    expect(support.get(actionId(bootstrap))).toEqual([]);
    expect(support.get(actionId(terminal))).toEqual([]);
  });

  it("derives causal register dependencies from semantic contributions", () => {
    const view = actionFact(1, {
      kind: "shared-default-view-add",
      hostNodeId: "workspace",
      viewType: "outline",
      anchor: end,
    });
    const firstMode = actionFact(2, { kind: "view-mode-set", viewId: actionId(view), viewType: "table" });
    const secondMode = actionFact(3, { kind: "view-mode-set", viewId: actionId(view), viewType: "outline" });

    const support = deriveSupport(factActionsFromFacts([view, firstMode, secondMode]));

    expect(support.get(actionId(firstMode))).toContain(actionId(view));
    expect(support.get(actionId(secondMode))).toEqual([actionId(view), actionId(firstMode)]);
  });

  it("derives observed collection-removal support without an Action-kind interpreter", () => {
    const addition = actionFact(1, {
      kind: "template-member-add",
      supertagId: "supertag",
      templateNodeId: "template",
      anchor: end,
    });
    const removal = actionFact(2, {
      kind: "template-member-remove",
      supertagId: "supertag",
      templateNodeId: "template",
    });

    const support = deriveSupport(factActionsFromFacts([addition, removal]));

    expect(support.get(actionId(removal))).toContain(actionId(addition));
  });

  it("derives generated occurrence support from semantic contributions", () => {
    const detachment = actionFact(1, {
      kind: "template-node-detach",
      ownerNodeId: "workspace",
      templateNodeId: "template",
      instanceNodeId: "instance",
      instanceOccurrenceId: "instance-occurrence",
      anchor: end,
    });
    const materialization = actionFact(2, {
      kind: "placement-create",
      placementId: "instance-occurrence",
      nodeId: "instance",
      parentNodeId: "workspace",
      anchor: end,
    });

    const support = deriveSupport(factActionsFromFacts([detachment, materialization]));

    expect(support.get(actionId(detachment))).toContain(actionId(materialization));
  });

  it("an occurrence depends on the parent Node Action Fact", () => {
    const childNode = actionFact(1, {
      kind: "node-create",
      nodeId: "child",
      ownerNodeId: "workspace",
      originalPlacement: null,
    });
    const parentNode = actionFact(
      2,
      { kind: "node-create", nodeId: "parent", ownerNodeId: "workspace", originalPlacement: null },
      "proposal",
    );
    const child = actionFact(3, {
      kind: "placement-create",
      placementId: "child-placement",
      nodeId: "child",
      parentNodeId: "parent",
      anchor: end,
    });
    const pending = [childNode, parentNode, child];
    const support = deriveSupport(factActionsFromFacts(pending));
    expect(support.get(actionId(child))).toContain(actionId(parentNode));
    expect(project(pending, "origin").occurrences["child-placement"]).toBeUndefined();
    expect(project(pending, "review").occurrences["child-placement"]?.parentNodeId).toBe("parent");

    const rejected = [...pending, resolution(4, [parentNode.id], "reject")];
    expect(project(rejected, "review").occurrences["child-placement"]).toBeUndefined();

    const accepted = [...pending, resolution(4, [parentNode.id], "accept")];
    expect(project(accepted, "origin").occurrences["child-placement"]?.parentNodeId).toBe("parent");
  });
});

function project(facts: readonly Fact[], perspective: "origin" | "review") {
  const workspace = makeFact({
    workspaceId: "workspace",
    replicaId: "808",
    sequence: 1,
    observed: {},
    lamport: 1,
    body: {
      kind: "action",
      actorId: "workspace-genesis",
      intent: "direct",
      actions: [{ kind: "node-create", nodeId: "workspace", ownerNodeId: "workspace", originalPlacement: null }],
    },
  });
  const projectedFacts = [workspace, ...facts];
  return projectSnapshot(
    "workspace",
    { facts: projectedFacts, frontier: frontierOf(projectedFacts) },
    perspective,
    versions,
  );
}

function resolution(sequence: number, proposalFactIds: readonly FactId[], decision: "accept" | "reject"): Fact {
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
      proposalFactIds,
    },
  });
}

function actionId(fact: Fact): FactActionId {
  return factActionId(fact.id, 0);
}

function actionFact(sequence: number, authoredAction: GraphAction, intent: "direct" | "proposal" = "direct"): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: graphActionBody("actor", intent, [authoredAction]),
  });
}
