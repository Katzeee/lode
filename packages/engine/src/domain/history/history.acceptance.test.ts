import { describe, expect, it } from "vitest";

import { queryReview } from "../review/index.js";
import { queryHistory, validateHistorySelection } from "./history.js";
import { rebuildHistoryState } from "./state.js";
import { baseFixture, end } from "./history-test-helpers.js";

describe("production History contracts", () => {
  it("HIST-1 durable local channels exclude resolutions", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "a-1",
      channelId: "a",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "property",
          key: "a",
          value: 1,
          previous: { kind: "unset" },
        },
      ],
    });
    fixture.step({
      invocationId: "b-1",
      channelId: "b",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "property",
          key: "b",
          value: 1,
          previous: { kind: "unset" },
        },
      ],
    });
    fixture.receipts.push({
      workspaceId: "workspace",
      replicaId: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      invocationId: "resolution",
      requestDigest: "resolution",
      factIds: [],
      committedFrontier: fixture.snapshot().frontier,
      lineage: null,
    });

    expect(rebuildHistoryState(fixture.receipts, "a").undoStack).toEqual(["a-1"]);
    expect(rebuildHistoryState(fixture.receipts, "b").undoStack).toEqual(["b-1"]);
  });

  it("HIST-2 history selection uses semantic freshness", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "target",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "property",
          key: "color",
          value: "blue",
          previous: { kind: "unset" },
        },
      ],
    });
    const selection = queryHistory(
      "channel",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    ).undo!;
    fixture.step({
      invocationId: "other-channel",
      channelId: "other",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "metadata",
          key: "other",
          value: 0,
          previous: { kind: "unset" },
        },
      ],
    });
    expect(
      validateHistorySelection(
        selection,
        "actor",
        fixture.receipts,
        fixture.snapshot(),
        fixture.generation(),
      ).kind,
    ).toBe("ready");

    fixture.step({
      invocationId: "same-channel",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "metadata",
          key: "new",
          value: true,
          previous: { kind: "unset" },
        },
      ],
    });
    expect(
      validateHistorySelection(
        selection,
        "actor",
        fixture.receipts,
        fixture.snapshot(),
        fixture.generation(),
      ).kind,
    ).toBe("stale");
  });

  it("HIST-3 compensation is selective atomic and intent-preserving", () => {
    const fixture = baseFixture();
    fixture.fact({ kind: "node-create", nodeId: "target-parent" });
    fixture.fact({
      kind: "occurrence-create",
      occurrenceId: "target-parent-occurrence",
      nodeId: "target-parent",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    });
    const step = fixture.step({
      invocationId: "compound",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "A",
        },
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "property",
          key: "color",
          value: "blue",
          previous: { kind: "unset" },
        },
        {
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentOccurrenceId: "target-parent-occurrence",
          anchor: end,
          previousParentOccurrenceId: null,
          previousAnchor: end,
        },
      ],
      intent: "proposal",
    });
    fixture.fact({
      kind: "value-set",
      owner: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
      value: "red",
      previous: { kind: "set", value: "blue" },
    });
    const selection = queryHistory(
      "channel",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    ).undo!;
    const plan = validateHistorySelection(
      selection,
      "undoer",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );

    expect(step.factIds).toHaveLength(3);
    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") {
      return;
    }
    expect(plan.bodies.every((body) => body.intent === "proposal")).toBe(true);
    expect(plan.bodies.map((body) => body.mutation.kind)).toEqual([
      "occurrence-move",
      "text-splice",
    ]);
  });

  it("HIST-4 every owner compensates semantically without snapshots", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "schema-field",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "schema", id: "schema" },
          namespace: "schema",
          key: "field",
          value: 0,
          previous: { kind: "unset" },
        },
        {
          kind: "value-set",
          owner: { kind: "field", id: "field" },
          namespace: "metadata",
          key: "label",
          value: "Field",
          previous: { kind: "unset" },
        },
      ],
    });
    const selection = queryHistory(
      "channel",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    ).undo!;
    const plan = validateHistorySelection(
      selection,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") {
      return;
    }
    expect(plan.bodies.map((body) => body.mutation)).toEqual([
      {
        kind: "value-unset",
        owner: { kind: "field", id: "field" },
        namespace: "metadata",
        key: "label",
        previous: { kind: "set", value: "Field" },
      },
      {
        kind: "value-unset",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key: "field",
        previous: { kind: "set", value: 0 },
      },
    ]);

    const deletedOwner = baseFixture();
    deletedOwner.step({
      invocationId: "nullable-value",
      mutations: [
        {
          kind: "value-set",
          owner: { kind: "node", id: "node" },
          namespace: "property",
          key: "nullable",
          value: null,
          previous: { kind: "unset" },
        },
      ],
    });
    deletedOwner.fact({ kind: "node-delete", nodeId: "node" });
    expect(
      queryHistory(
        "channel",
        deletedOwner.receipts,
        deletedOwner.snapshot(),
        deletedOwner.generation(),
      ).undo,
    ).toBeNull();
  });

  it("HIST-5 proposal net-zero emits no empty review item", () => {
    const fixture = baseFixture();
    fixture.step({
      invocationId: "proposal",
      intent: "proposal",
      mutations: [
        {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "P",
        },
      ],
    });
    const undo = queryHistory(
      "channel",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    ).undo!;
    const plan = validateHistorySelection(
      undo,
      "actor",
      fixture.receipts,
      fixture.snapshot(),
      fixture.generation(),
    );
    if (plan.kind !== "ready") {
      throw new Error("Proposal Undo must be ready");
    }
    fixture.step({
      invocationId: "undo",
      intent: "proposal",
      operation: "undo",
      targetStepId: "proposal",
      mutations: plan.bodies.map((body) => body.mutation),
    });
    expect(queryReview("workspace", fixture.snapshot(), fixture.generation()).hunks).toHaveLength(
      0,
    );
  });

  it("accepted and rejected Proposal steps leave History instead of being compensated", () => {
    for (const decision of ["accept", "reject"] as const) {
      const fixture = baseFixture();
      const step = fixture.step({
        invocationId: `proposal-${decision}`,
        intent: "proposal",
        mutations: [
          {
            kind: "value-set",
            owner: { kind: "node", id: "node" },
            namespace: "property",
            key: decision,
            value: true,
            previous: { kind: "unset" },
          },
        ],
      });
      fixture.resolve(step.factIds, decision);
      expect(
        queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo,
      ).toBeNull();
    }
  });
});
