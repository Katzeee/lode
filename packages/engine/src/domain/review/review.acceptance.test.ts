import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import { canonicalDigest, type ContributionFact } from "../fact/index.js";
import { impactAddress, valueKeyAddress } from "../reconcile/index.js";
import { projectionText } from "../../../tests/support/reconcile/projection.js";
import { queryReview, validateReviewSelection } from "./review.js";
import { evidenceForTargets } from "./evidence.js";
import { createReviewReadModel } from "./read-model.js";
import type { ReviewSelection } from "./types.js";
import {
  REPLICA_A,
  REPLICA_B,
  REPLICA_C,
  base,
  end,
  generation,
  remoteFact,
} from "../../../tests/support/review/review-test-helpers.js";

describe("production Review contracts", () => {
  it("groups pending mutations from different Review families through shared scope associations", () => {
    const facts = base();
    const text = facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    const value = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "state",
        value: "proposal",
        previous: { kind: "unset" },
      },
      "proposal",
    );
    const snapshot = facts.snapshot();

    const model = createReviewReadModel(snapshot, generation(snapshot).review);

    expect(Object.values(model.scopes)).toEqual([[text.id, value.id]]);
  });

  it("composite value addresses cannot collide through user identities or keys", () => {
    const left = {
      kind: "value-set" as const,
      target: { kind: "node" as const, id: "a" },
      namespace: "property" as const,
      key: "x/metadata/y",
      value: 1,
      previous: { kind: "unset" as const },
    };
    const right = {
      kind: "value-set" as const,
      target: { kind: "node" as const, id: "a/property/x" },
      namespace: "metadata" as const,
      key: "y",
      value: 2,
      previous: { kind: "unset" as const },
    };
    expect(valueKeyAddress(left.target, left.namespace, left.key)).not.toBe(
      valueKeyAddress(right.target, right.namespace, right.key),
    );
  });

  it("nullable impact segments cannot collide with user occurrence identities", () => {
    expect(impactAddress("occurrence", "x", "origin-parent", null)).not.toBe(
      impactAddress("occurrence", "x", "origin-parent", "<root>"),
    );
  });

  it("REVIEW-1 distinguishes explicit JSON null from an unset value", () => {
    for (const operation of ["set-null", "unset-null"] as const) {
      const facts = base();
      if (operation === "unset-null") {
        facts.add({
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "nullable",
          value: null,
          previous: { kind: "unset" },
        });
      }
      const proposal = facts.add(
        operation === "set-null"
          ? {
              kind: "value-set",
              target: { kind: "node", id: "node" },
              namespace: "property",
              key: "nullable",
              value: null,
              previous: { kind: "unset" },
            }
          : {
              kind: "value-unset",
              target: { kind: "node", id: "node" },
              namespace: "property",
              key: "nullable",
              previous: { kind: "set", value: null },
            },
        "proposal",
      );
      const pending = facts.snapshot();
      const review = queryReview("workspace", pending, generation(pending));
      expect(review.hunks).toHaveLength(1);
      expect(review.hunks[0]?.selection.evidence.effects).toContainEqual(
        expect.objectContaining({
          kind: "value",
          origin: operation === "set-null" ? { kind: "unset" } : { kind: "set", value: null },
          review: operation === "set-null" ? { kind: "set", value: null } : { kind: "unset" },
        }),
      );
      facts.addBody({
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      });
      const terminal = generation(facts.snapshot());
      expect(terminal.origin.nodes.node?.properties.nullable).toBe(operation === "set-null" ? null : undefined);
      expect(terminal.review.nodes.node?.properties.nullable).toBe(operation === "set-null" ? null : undefined);
      expect(queryReview("workspace", facts.snapshot(), terminal).hunks).toHaveLength(0);
    }
  });

  it("REVIEW-1 hunks are derived typed net differences", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "blue",
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const review = queryReview("workspace", snapshot, generation(snapshot));

    expect(review.hunks).toHaveLength(1);
    expect(review.hunks[0]).toMatchObject({
      diffSpace: { kind: "value", identity: "node/node/property/color" },
      proposalContributionIds: [proposal.id],
    });
    expect(snapshot).not.toHaveProperty("hunks");
  });

  it("REVIEW-2 scope is visible targets plus minimal support closure", () => {
    const facts = base();
    const created = facts.addPlaced("proposal-node", "workspace", "proposal-occurrence", "proposal");
    const [node, occurrence] = created;
    if (!node || !occurrence) {
      throw new Error("Expected a Node creation transaction");
    }
    const snapshot = facts.snapshot();
    const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find((candidate) =>
      candidate.proposalContributionIds.includes(occurrence.id),
    );
    expect(hunk?.selection.evidence.supportClosure).toEqual([node.id, occurrence.id]);
  });

  it("AUTH-4 resolutions capture exact support-closed targets", () => {
    const facts = base();
    const created = facts.addPlaced("proposal-node", "workspace", "proposal-occurrence", "proposal");
    const [node, occurrence] = created;
    if (!node || !occurrence) {
      throw new Error("Expected a Node creation transaction");
    }
    const snapshot = facts.snapshot();
    const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find((candidate) =>
      candidate.proposalContributionIds.includes(occurrence.id),
    );
    if (!hunk) {
      throw new Error("Expected a support-closed Review Hunk");
    }
    const resolution = validateReviewSelection(
      "workspace",
      hunk.selection,
      "accept",
      "reviewer",
      snapshot,
      generation(snapshot),
    );
    expect(resolution).toMatchObject({
      kind: "valid",
      resolution: { proposalContributionIds: [node.id, occurrence.id] },
    });
  });

  it("keeps every proposal Fact in one transaction inside the same decision boundary", () => {
    const facts = base();
    const transaction = facts.addTransaction(
      [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "color",
          value: "blue",
          previous: { kind: "unset" },
        },
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "shape",
          value: "round",
          previous: { kind: "unset" },
        },
      ],
      "proposal",
    );
    const snapshot = facts.snapshot();
    const color = queryReview("workspace", snapshot, generation(snapshot)).hunks.find(
      (hunk) => hunk.diffSpace.kind === "value" && hunk.diffSpace.identity.endsWith("/color"),
    );

    expect(color?.selection.evidence.supportClosure).toEqual(transaction.map((fact) => fact.id));
  });

  it("closes Review support and transaction membership to a fixed point", () => {
    const facts = base();
    const target = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "target",
        value: true,
        previous: { kind: "unset" },
      },
      "proposal",
    );
    const transaction = facts.addTransaction(
      [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "support-a",
          value: true,
          previous: { kind: "unset" },
        },
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "support-b",
          value: true,
          previous: { kind: "unset" },
        },
      ],
      "proposal",
    );
    const terminalSupport = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "support-c",
        value: true,
        previous: { kind: "unset" },
      },
      "proposal",
    );
    const [firstSupport, secondSupport] = transaction;
    if (!firstSupport || !secondSupport) {
      throw new Error("Expected support transaction");
    }
    const snapshot = facts.snapshot();
    const pending = new Map(
      [target, firstSupport, secondSupport, terminalSupport]
        .filter((fact): fact is ContributionFact => fact.body.kind === "contribution")
        .map((fact) => [fact.id, fact]),
    );
    const evidence = evidenceForTargets(snapshot, generation(snapshot), [target.id], {
      pending,
      supportByContribution: new Map([
        [target.id, [firstSupport.id]],
        [secondSupport.id, [terminalSupport.id]],
      ]),
    });

    expect(evidence?.supportClosure).toEqual([target.id, firstSupport.id, secondSupport.id, terminalSupport.id].sort());
  });

  it("REVIEW-3 terminal resolutions converge neutrally per contribution", () => {
    const facts = base();
    const proposal = facts.add(
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "P" },
      "proposal",
    );
    const observed = { [REPLICA_A]: facts.values.length };
    const accept = remoteFact({
      replicaId: REPLICA_B,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "b",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      },
    });
    const reject = remoteFact({
      replicaId: REPLICA_C,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "c",
        decision: "reject",
        proposalContributionIds: [proposal.id],
      },
    });
    const left = generation(facts.snapshot([accept, reject]));
    const right = generation(facts.snapshot([reject, accept]));
    expect(left).toEqual(right);
    expect(projectionText(left.origin, "node")).toBe("");
    expect(projectionText(left.review, "node")).toBe("P");
    expect(queryReview("workspace", facts.snapshot([accept, reject]), left).hunks).toHaveLength(1);
  });

  it("REVIEW-4 neutral text bridges preserve direct atoms", () => {
    const facts = base();
    const proposal = facts.add(
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "日本" },
      "proposal",
    );
    const bridge = remoteFact({
      replicaId: REPLICA_B,
      observed: { [REPLICA_A]: facts.values.length },
      lamport: facts.values.length + 1,
      body: {
        kind: "contribution",
        actorId: "direct",
        intent: "direct",
        mutation: {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          anchor: {
            after: `${proposal.id}#0`,
            before: `${proposal.id}#1`,
            affinity: "after",
            fallback: "end",
          },
          insert: "年度",
        },
      },
    });
    const snapshot = facts.snapshot([bridge]);
    const projected = generation(snapshot);
    const hunk = queryReview("workspace", snapshot, projected).hunks[0];

    expect(projectionText(projected.review, "node")).toBe("日年度本");
    expect(hunk?.neutralBridgeAtomIds).toEqual([`${bridge.id}#0`, `${bridge.id}#1`]);
    expect(hunk?.selection.evidence.proposalTargets).toEqual([proposal.id]);
  });

  it("已观察后的重复决议", () => {
    const facts = base();
    const proposal = facts.addPlaced("proposal", "workspace", "proposal-original", "proposal");
    facts.addBody({
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision: "accept",
      proposalContributionIds: proposal.map((fact) => fact.id),
    });
    facts.addBody({
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "reviewer",
      decision: "reject",
      proposalContributionIds: proposal.map((fact) => fact.id),
    });
    const admission = admitAuthorityRecords(
      "workspace",
      facts.values.map((fact) => ({ recordKind: "fact" as const, fact })),
    );
    expect(admission.kind).toBe("fault");
    expect(admission.fault).toContain("already terminal");
  });

  it("serialized Review capabilities cannot forge a scope across independent Diff Spaces", () => {
    const facts = base();
    for (const key of ["left", "right"]) {
      facts.add(
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key,
          value: true,
        },
        "proposal",
      );
    }
    const snapshot = facts.snapshot();
    const projected = generation(snapshot);
    const hunks = queryReview("workspace", snapshot, projected).hunks;
    expect(hunks).toHaveLength(2);
    const [left, right] = hunks;
    if (!left || !right) {
      throw new Error("Expected two independent Review Hunks");
    }
    const evidence = {
      ...left.selection.evidence,
      proposalTargets: [...left.selection.evidence.proposalTargets, ...right.selection.evidence.proposalTargets],
      supportClosure: [...left.selection.evidence.supportClosure, ...right.selection.evidence.supportClosure],
      effects: [...left.selection.evidence.effects, ...right.selection.evidence.effects],
      associatedImpactIds: [
        ...new Set([...left.selection.evidence.associatedImpactIds, ...right.selection.evidence.associatedImpactIds]),
      ],
    };
    const forged = {
      ...left.selection,
      evidence,
      token: canonicalDigest({
        workspaceId: "workspace",
        generationId: projected.identity.generationId,
        evidence,
      }),
    } as ReviewSelection;

    expect(validateReviewSelection("workspace", forged, "accept", "reviewer", snapshot, projected).kind).toBe("stale");
  });
});
