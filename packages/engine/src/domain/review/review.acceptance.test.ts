import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import { canonicalDigest } from "../fact/index.js";
import { impactAddress, projectionText } from "../reconcile/index.js";
import { queryReview, validateReviewSelection } from "./review.js";
import { valueAddress } from "./evidence.js";
import type { ReviewSelection } from "./types.js";
import {
  REPLICA_A,
  REPLICA_B,
  REPLICA_C,
  base,
  end,
  generation,
  remoteFact,
} from "./review-test-helpers.js";

describe("production Review contracts", () => {
  it("composite value addresses cannot collide through user identities or keys", () => {
    const left = {
      kind: "value-set" as const,
      owner: { kind: "node" as const, id: "a" },
      namespace: "property" as const,
      key: "x/metadata/y",
      value: 1,
      previous: { kind: "unset" as const },
    };
    const right = {
      kind: "value-set" as const,
      owner: { kind: "node" as const, id: "a/property/x" },
      namespace: "metadata" as const,
      key: "y",
      value: 2,
      previous: { kind: "unset" as const },
    };
    expect(valueAddress(left)).not.toBe(valueAddress(right));
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
          owner: { kind: "node", id: "node" },
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
              owner: { kind: "node", id: "node" },
              namespace: "property",
              key: "nullable",
              value: null,
              previous: { kind: "unset" },
            }
          : {
              kind: "value-unset",
              owner: { kind: "node", id: "node" },
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
        actorId: "reviewer",
        decision: "accept",
        proposalContributionIds: [proposal.id],
      });
      const terminal = generation(facts.snapshot());
      expect(terminal.origin.nodes.node?.properties.nullable).toBe(
        operation === "set-null" ? null : undefined,
      );
      expect(terminal.review.nodes.node?.properties.nullable).toBe(
        operation === "set-null" ? null : undefined,
      );
      expect(queryReview("workspace", facts.snapshot(), terminal).hunks).toHaveLength(0);
    }
  });

  it("REVIEW-1 hunks are derived typed net differences", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "value-set",
        owner: { kind: "node", id: "node" },
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
    const node = facts.add({ kind: "node-create", nodeId: "proposal-node" }, "proposal");
    const occurrence = facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "proposal-occurrence",
        nodeId: "proposal-node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find((candidate) =>
      candidate.proposalContributionIds.includes(occurrence.id),
    );
    expect(hunk?.selection.evidence.supportClosure).toEqual([node.id, occurrence.id]);
  });

  it("AUTH-4 resolutions capture exact support-closed targets", () => {
    const facts = base();
    const node = facts.add({ kind: "node-create", nodeId: "proposal-node" }, "proposal");
    const occurrence = facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "proposal-occurrence",
        nodeId: "proposal-node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      },
      "proposal",
    );
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
        actorId: "c",
        decision: "reject",
        proposalContributionIds: [proposal.id],
      },
    });
    const left = generation(facts.snapshot([accept, reject]));
    const right = generation(facts.snapshot([reject, accept]));
    expect(left).toEqual(right);
    expect(projectionText(left.origin, "node")).toBe("");
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

  it("REVIEW-5 selection freshness compares typed decision evidence", () => {
    const facts = base();
    facts.add(
      {
        kind: "value-set",
        owner: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "blue",
      },
      "proposal",
    );
    const selectedSnapshot = facts.snapshot();
    const selectedHunk = queryReview("workspace", selectedSnapshot, generation(selectedSnapshot))
      .hunks[0];
    if (!selectedHunk) {
      throw new Error("Expected a value Review Hunk");
    }
    const selection = selectedHunk.selection;

    facts.add({ kind: "node-create", nodeId: "unrelated" });
    const current = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        current,
        generation(current),
      ).kind,
    ).toBe("valid");

    const newVersions = {
      rulesVersion: "unknown-rules",
      schemaVersion: "proposal-schema-1",
    } as const;
    expect(() => generation(current, newVersions)).toThrow("Unsupported projection versions");
  });

  it("已观察后的重复决议", () => {
    const facts = base();
    const proposal = facts.add({ kind: "node-create", nodeId: "proposal" }, "proposal");
    const first = facts.addBody({
      kind: "resolution",
      actorId: "reviewer",
      decision: "accept",
      proposalContributionIds: [proposal.id],
    });
    const repeated = facts.addBody({
      kind: "resolution",
      actorId: "reviewer",
      decision: "reject",
      proposalContributionIds: [proposal.id],
    });
    const admission = admitAuthorityRecords(
      "workspace",
      facts.values.map((fact) => ({ recordKind: "fact" as const, fact })),
    );
    expect(first.id).not.toBe(repeated.id);
    expect(admission.kind).toBe("fault");
    expect(admission.fault).toContain("already terminal");
  });

  it("serialized Review capabilities cannot forge a scope across independent Diff Spaces", () => {
    const facts = base();
    for (const key of ["left", "right"]) {
      facts.add(
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
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
      proposalTargets: [
        ...left.selection.evidence.proposalTargets,
        ...right.selection.evidence.proposalTargets,
      ],
      supportClosure: [
        ...left.selection.evidence.supportClosure,
        ...right.selection.evidence.supportClosure,
      ],
      effects: [...left.selection.evidence.effects, ...right.selection.evidence.effects],
      associatedImpactIds: [
        ...new Set([
          ...left.selection.evidence.associatedImpactIds,
          ...right.selection.evidence.associatedImpactIds,
        ]),
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

    expect(
      validateReviewSelection("workspace", forged, "accept", "reviewer", snapshot, projected).kind,
    ).toBe("stale");
  });
});
