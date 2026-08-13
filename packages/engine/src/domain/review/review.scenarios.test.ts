import { describe, expect, it } from "vitest";

import { queryReview, validateReviewSelection } from "./review.js";
import { base, end, generation, remoteFact } from "./review-test-helpers.js";

describe("production Review scenarios", () => {
  it("Direct/Proposal 交错文本", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "second-parent" });
    const proposal = facts.add(
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "P" },
      "proposal",
    );
    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: {
        after: `${proposal.id}#0`,
        before: null,
        affinity: "after",
        fallback: "end",
      },
      insert: "D",
    });
    const projected = generation(facts.snapshot());
    expect(projected.origin.nodes.node?.text.map((atom) => atom.value).join("")).toBe("D");
    expect(projected.review.nodes.node?.text.map((atom) => atom.value).join("")).toBe("PD");
  });

  it("Text neutral bridge 边界", () => {
    const facts = base();
    const origin = facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "中",
    });
    facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: { after: null, before: `${origin.id}#0`, affinity: "before", fallback: "start" },
        insert: "左",
      },
      "proposal",
    );
    facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: { after: `${origin.id}#0`, before: null, affinity: "after", fallback: "end" },
        insert: "右",
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    expect(queryReview("workspace", snapshot, generation(snapshot)).hunks).toHaveLength(2);
  });

  it("结构替换呈现", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "old" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "old-occurrence",
      nodeId: "old",
      parentNodeId: "node",
      anchor: end,
    });
    const removal = facts.add(
      { kind: "occurrence-delete", occurrenceId: "old-occurrence" },
      "proposal",
    );
    facts.add({ kind: "node-create", nodeId: "new" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "new-original",
      nodeId: "new",
      parentNodeId: "workspace",
      anchor: end,
    });
    const addition = facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "new-occurrence",
        nodeId: "new",
        parentNodeId: "node",
        anchor: end,
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const structural = queryReview("workspace", snapshot, generation(snapshot)).hunks.filter(
      (hunk) => hunk.diffSpace.kind === "child-sequence",
    );
    expect(structural).toHaveLength(1);
    expect(structural[0]?.proposalContributionIds).toEqual([removal.id, addition.id]);
  });

  it("unchanged sibling identities split local ChildSequence Diff Spaces", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "middle-node" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "middle",
      nodeId: "middle-node",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add({ kind: "node-create", nodeId: "left-proposal-node" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "left-original",
      nodeId: "left-proposal-node",
      parentNodeId: "node",
      anchor: end,
    });
    const left = facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "left-proposal",
        nodeId: "left-proposal-node",
        parentNodeId: "workspace",
        anchor: { after: "occurrence", before: "middle", affinity: "after", fallback: "end" },
      },
      "proposal",
    );
    facts.add({ kind: "node-create", nodeId: "right-proposal-node" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "right-original",
      nodeId: "right-proposal-node",
      parentNodeId: "node",
      anchor: end,
    });
    const right = facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "right-proposal",
        nodeId: "right-proposal-node",
        parentNodeId: "workspace",
        anchor: { after: "middle", before: null, affinity: "after", fallback: "end" },
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const structural = queryReview("workspace", snapshot, generation(snapshot)).hunks.filter(
      (hunk) => hunk.diffSpace.kind === "child-sequence",
    );
    expect(structural.map((hunk) => hunk.proposalContributionIds)).toEqual([[left.id], [right.id]]);
  });

  it("Move 双端点", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "target" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "target-occurrence",
      nodeId: "target",
      parentNodeId: "workspace",
      anchor: end,
    });
    const move = facts.add(
      {
        kind: "occurrence-move",
        occurrenceId: "occurrence",
        parentNodeId: "target",
        anchor: end,
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const endpoints = queryReview("workspace", snapshot, generation(snapshot)).hunks.filter(
      (hunk) => hunk.proposalContributionIds.includes(move.id),
    );
    expect(endpoints).toHaveLength(2);
    expect(endpoints.every((hunk) => hunk.linkedHunkIds.length === 1)).toBe(true);
  });

  it("same-parent Proposal reorder has stable placement evidence and one sequence Hunk", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "other" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "other",
      nodeId: "other",
      parentNodeId: "workspace",
      anchor: end,
    });
    const reorder = facts.add(
      {
        kind: "occurrence-move",
        occurrenceId: "occurrence",
        parentNodeId: "workspace",
        anchor: { ...end, after: "other" },
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const hunks = queryReview("workspace", snapshot, generation(snapshot)).hunks.filter((hunk) =>
      hunk.proposalContributionIds.includes(reorder.id),
    );

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.selection.evidence.effects).toMatchObject([
      {
        kind: "structure",
        originParentId: "workspace",
        reviewParentId: "workspace",
        anchor: { after: "other" },
        originRelation: { afterEndpoint: "before" },
        reviewRelation: { afterEndpoint: "after" },
      },
    ]);
    const selection = hunks[0]?.selection;
    if (!selection) {
      throw new Error("Expected reorder selection");
    }
    facts.add({ kind: "node-create", nodeId: "unrelated" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "unrelated",
      nodeId: "unrelated",
      parentNodeId: "workspace",
      anchor: end,
    });
    const advanced = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        advanced,
        generation(advanced),
      ).kind,
    ).toBe("valid");
  });

  it("Shared Node 全局影响", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "reference-parent" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    const deletion = facts.add({ kind: "node-delete", nodeId: "node" }, "proposal");
    const snapshot = facts.snapshot();
    const impacts = queryReview("workspace", snapshot, generation(snapshot)).hunks.filter((hunk) =>
      hunk.proposalContributionIds.includes(deletion.id),
    );
    expect(impacts).toHaveLength(2);
    expect(impacts.every((hunk) => hunk.linkedHunkIds.length === 1)).toBe(true);
  });

  it("shared Node property selection stales only when its transclusion impact set changes", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "reference-parent" });
    facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "blue",
      },
      "proposal",
    );
    const before = facts.snapshot();
    const selection = queryReview("workspace", before, generation(before)).hunks[0]?.selection;
    if (!selection) {
      throw new Error("Expected property Review selection");
    }
    facts.add({ kind: "node-create", nodeId: "unrelated" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "unrelated",
      nodeId: "unrelated",
      parentNodeId: "workspace",
      anchor: end,
    });
    let current = facts.snapshot();
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

    facts.add({
      kind: "occurrence-create",
      occurrenceId: "shared-reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    current = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        current,
        generation(current),
      ).kind,
    ).toBe("stale");
  });

  it("Review selection 无关前进", () => {
    const facts = base();
    facts.add(
      { kind: "text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "A" },
      "proposal",
    );
    const before = facts.snapshot();
    const selectedHunk = queryReview("workspace", before, generation(before)).hunks[0];
    if (!selectedHunk) {
      throw new Error("Expected a text Review Hunk");
    }
    const selection = selectedHunk.selection;
    facts.add({ kind: "node-create", nodeId: "unrelated" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "unrelated",
      nodeId: "unrelated",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add(
      { kind: "text-splice", nodeId: "unrelated", deleteAtomIds: [], anchor: end, insert: "B" },
      "proposal",
    );
    const after = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        after,
        generation(after),
      ).kind,
    ).toBe("valid");
  });

  it("Review selection survives a Hunk merge caused only by removing Direct adjacency", () => {
    const facts = base();
    const origin = facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "O",
    });
    const left = facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: {
          after: null,
          before: `${origin.id}#0`,
          affinity: "before",
          fallback: "start",
        },
        insert: "A",
      },
      "proposal",
    );
    facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: {
          after: `${origin.id}#0`,
          before: null,
          affinity: "after",
          fallback: "end",
        },
        insert: "B",
      },
      "proposal",
    );
    const before = facts.snapshot();
    const hunks = queryReview("workspace", before, generation(before)).hunks;
    expect(hunks).toHaveLength(2);
    const selection = hunks.find((hunk) =>
      hunk.proposalContributionIds.includes(left.id),
    )?.selection;
    if (!selection) {
      throw new Error("Expected the left Proposal Hunk");
    }

    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [`${origin.id}#0`],
      deletedAtoms: [{ id: `${origin.id}#0`, value: "O", attributes: {} }],
      anchor: end,
      insert: "",
    });
    const after = facts.snapshot();
    expect(queryReview("workspace", after, generation(after)).hunks).toHaveLength(1);
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        after,
        generation(after),
      ).kind,
    ).toBe("valid");
  });

  it("Review selection 相关变化", () => {
    const facts = base();
    const proposal = facts.add({ kind: "node-create", nodeId: "proposal" }, "proposal");
    const before = facts.snapshot();
    const selection = queryReview("workspace", before, generation(before)).hunks.find((hunk) =>
      hunk.proposalContributionIds.includes(proposal.id),
    )!.selection;
    facts.addBody({
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId: "other",
      decision: "reject",
      proposalContributionIds: [proposal.id],
    });
    const after = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selection,
        "accept",
        "reviewer",
        after,
        generation(after),
      ).kind,
    ).toBe("stale");
  });

  it("同目标离线相反决议", () => {
    const facts = base();
    const proposal = facts.add({ kind: "node-create", nodeId: "proposal" }, "proposal");
    const observed = { aaaaaaaaaaaaaaaaaaaaaaaaaa: facts.values.length };
    const accept = remoteFact({
      replicaId: "bbbbbbbbbbbbbbbbbbbbbbbbbb",
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
      replicaId: "cccccccccccccccccccccccccc",
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
    expect(generation(facts.snapshot([accept, reject]))).toEqual(
      generation(facts.snapshot([reject, accept])),
    );
  });

  it("重叠和不重叠 scopes", () => {
    const facts = base();
    const first = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "blue",
      },
      "proposal",
    );
    const second = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "red",
      },
      "proposal",
    );
    const third = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "size",
        value: 2,
      },
      "proposal",
    );
    const hunks = queryReview("workspace", facts.snapshot(), generation(facts.snapshot())).hunks;
    expect(hunks).toHaveLength(2);
    expect(hunks.flatMap((hunk) => hunk.proposalContributionIds)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(
      hunks.some(
        (hunk) =>
          hunk.proposalContributionIds.includes(first.id) &&
          hunk.proposalContributionIds.includes(second.id),
      ),
    ).toBe(true);

    const observed = facts.snapshot().frontier;
    const acceptOverlap = remoteFact({
      replicaId: "bbbbbbbbbbbbbbbbbbbbbbbbbb",
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "b",
        decision: "accept",
        proposalContributionIds: [second.id, third.id],
      },
    });
    const rejectOverlap = remoteFact({
      replicaId: "cccccccccccccccccccccccccc",
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "c",
        decision: "reject",
        proposalContributionIds: [second.id],
      },
    });
    const merged = generation(facts.snapshot([acceptOverlap, rejectOverlap]));
    expect(merged).toEqual(generation(facts.snapshot([rejectOverlap, acceptOverlap])));
    expect(merged.origin.nodes.node?.properties.size).toBe(2);
  });

  it("same text-mark owner is one truthful decision scope", () => {
    for (const decision of ["accept", "reject"] as const) {
      const facts = base();
      const text = facts.add({
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "A",
      });
      const blue = facts.add(
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [`${text.id}#0`],
          key: "color",
          value: { kind: "set", value: "blue" },
          previous: { kind: "unset" },
        },
        "proposal",
      );
      const red = facts.add(
        {
          kind: "text-mark",
          nodeId: "node",
          atomIds: [`${text.id}#0`],
          key: "color",
          value: { kind: "set", value: "red" },
          previous: { kind: "set", value: "blue" },
        },
        "proposal",
      );
      const hunk = queryReview(
        "workspace",
        facts.snapshot(),
        generation(facts.snapshot()),
      ).hunks.find((candidate) => candidate.diffSpace.kind === "node-content");
      expect(hunk?.proposalContributionIds).toEqual([blue.id, red.id]);
      if (!hunk) {
        throw new Error("Expected one text mark Hunk");
      }
      facts.addBody({
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision,
        proposalContributionIds: hunk.selection.evidence.supportClosure,
      });
      const resolved = generation(facts.snapshot());
      expect(resolved.origin.nodes.node?.text[0]?.attributes.color).toBe(
        decision === "accept" ? "red" : undefined,
      );
      expect(resolved.review.nodes.node?.text[0]?.attributes.color).toBe(
        decision === "accept" ? "red" : undefined,
      );
    }
  });

  it("Schema Application placement changes do not hide related Review evidence", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "schema" });
    facts.add({ kind: "node-create", nodeId: "field" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "second-occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add({ kind: "schema-apply", nodeId: "node", schemaId: "schema", anchor: end });
    facts.add({ kind: "node-create", nodeId: "schema-field-template-field" }, "proposal");
    facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "schema-field-template-field-occurrence",
        nodeId: "schema-field-template-field",
        parentNodeId: "schema",
        anchor: end,
      },
      "proposal",
    );
    const field = facts.add(
      {
        kind: "schema-field-add",
        schemaId: "schema",
        fieldDefinitionId: "field",
        fieldNodeId: "schema-field-template-field",
        fieldOccurrenceId: "schema-field-template-field-occurrence",
        anchor: end,
      },
      "proposal",
    );
    const before = facts.snapshot();
    const selected = queryReview("workspace", before, generation(before)).hunks.find((hunk) =>
      hunk.proposalContributionIds.includes(field.id),
    )?.selection;
    if (!selected) {
      throw new Error("Expected Schema Field Hunk");
    }
    facts.add({
      kind: "node-owner-set",
      nodeId: "node",
      ownerNodeId: "second-parent",
      previousOwnerNodeId: "workspace",
    });
    const after = facts.snapshot();
    expect(
      validateReviewSelection(
        "workspace",
        selected,
        "accept",
        "reviewer",
        after,
        generation(after),
      ),
    ).toMatchObject({ kind: "valid" });
  });
});
