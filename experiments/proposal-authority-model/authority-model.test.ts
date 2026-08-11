import { describe, expect, it } from "vitest";
import {
  FactFirstAuthority,
  StateReviewAuthority,
  contribution,
  outlineFromOccurrence,
  resolution,
  visibleState,
  type Fact,
  type MaterializedState,
} from "./authority-model.js";

function visible(state: MaterializedState): ReturnType<typeof visibleState> {
  return visibleState(state);
}

function fullDomainScenario(): Fact[] {
  return [
    contribution("d-create-root", 1, "seed", "direct", {
      type: "create-node",
      nodeId: "n-root",
    }),
    contribution("d-root-occ", 2, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-root",
      nodeId: "n-root",
      parentOccurrenceId: null,
      canonical: true,
    }),
    contribution("d-root-text", 3, "seed", "direct", {
      type: "set-text",
      nodeId: "n-root",
      value: "Workspace",
    }),
    contribution("d-create-shared", 4, "seed", "direct", {
      type: "create-node",
      nodeId: "n-shared",
    }),
    contribution("d-shared-a", 5, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-shared-a",
      nodeId: "n-shared",
      parentOccurrenceId: "o-root",
      canonical: true,
    }),
    contribution("d-shared-b", 6, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-shared-b",
      nodeId: "n-shared",
      parentOccurrenceId: "o-root",
      canonical: false,
    }),
    contribution("d-shared-text", 7, "seed", "direct", {
      type: "set-text",
      nodeId: "n-shared",
      value: "Shared",
    }),
    contribution("d-color", 8, "seed", "direct", {
      type: "set-property",
      nodeId: "n-shared",
      key: "color",
      value: "blue",
    }),
    contribution("d-create-child", 9, "seed", "direct", {
      type: "create-node",
      nodeId: "n-child",
    }),
    contribution("d-child-occ", 10, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-child",
      nodeId: "n-child",
      parentOccurrenceId: "o-shared-a",
      canonical: true,
    }),
    contribution("d-child-text", 11, "seed", "direct", {
      type: "set-text",
      nodeId: "n-child",
      value: "Child",
    }),
    contribution("d-self-ref", 12, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-self-ref",
      nodeId: "n-shared",
      parentOccurrenceId: "o-shared-a",
      canonical: false,
    }),
    contribution("d-move-child", 13, "seed", "direct", {
      type: "move-occurrence",
      occurrenceId: "o-child",
      parentOccurrenceId: "o-root",
    }),
    contribution("d-delete-temp-node", 14, "seed", "direct", {
      type: "create-node",
      nodeId: "n-temp",
    }),
    contribution("d-delete-temp-occ", 15, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-temp",
      nodeId: "n-temp",
      parentOccurrenceId: "o-root",
      canonical: true,
    }),
    contribution("d-delete-occ", 16, "seed", "direct", {
      type: "delete-occurrence",
      occurrenceId: "o-temp",
    }),
    contribution("d-delete-node", 17, "seed", "direct", {
      type: "delete-node",
      nodeId: "n-temp",
    }),
    contribution("p-text", 18, "author", "proposal", {
      type: "set-text",
      nodeId: "n-shared",
      value: "Shared proposal",
    }),
    contribution("p-schema", 19, "author", "proposal", {
      type: "apply-schema",
      nodeId: "n-shared",
      schemaId: "task",
      defaults: { status: "open" },
    }),
    contribution("p-create-dependent", 20, "author", "proposal", {
      type: "create-node",
      nodeId: "n-dependent",
    }),
    contribution(
      "d-dependent-text",
      21,
      "editor",
      "direct",
      {
        type: "set-text",
        nodeId: "n-dependent",
        value: "Depends on pending creation",
      },
      2,
      ["p-create-dependent"],
    ),
  ];
}

function loadBoth(facts: readonly Fact[]): {
  factFirst: FactFirstAuthority;
  hybrid: StateReviewAuthority;
} {
  const factFirst = new FactFirstAuthority();
  const hybrid = new StateReviewAuthority();
  factFirst.ingestAll(facts);
  hybrid.ingestAll(facts);
  return { factFirst, hybrid };
}

describe("terminal authority candidate behavior", () => {
  it("covers every domain operation and gives both candidates the same Origin and Review", () => {
    const facts = fullDomainScenario();
    const { factFirst, hybrid } = loadBoth(facts);

    expect(visible(factFirst.origin())).toEqual(visible(hybrid.origin()));
    expect(visible(factFirst.review())).toEqual(visible(hybrid.review()));

    const originShared = visible(factFirst.origin()).nodes.find(
      (node) => node.nodeId === "n-shared",
    );
    const reviewShared = visible(factFirst.review()).nodes.find(
      (node) => node.nodeId === "n-shared",
    );
    expect(originShared).toMatchObject({
      text: "Shared",
      properties: { color: "blue" },
      schemas: [],
    });
    expect(reviewShared).toMatchObject({
      text: "Shared proposal",
      properties: { color: "blue", status: "open" },
      schemas: ["task"],
    });
    expect(visible(factFirst.origin()).nodes.some((node) => node.nodeId === "n-dependent")).toBe(
      false,
    );
    expect(
      visible(factFirst.review()).nodes.find((node) => node.nodeId === "n-dependent"),
    ).toMatchObject({ text: "Depends on pending creation" });

    const operationTypes = new Set(
      facts.filter((fact) => fact.kind === "contribution").map((fact) => fact.operation.type),
    );
    expect(operationTypes).toEqual(
      new Set([
        "create-node",
        "delete-node",
        "set-text",
        "set-property",
        "apply-schema",
        "create-occurrence",
        "move-occurrence",
        "delete-occurrence",
      ]),
    );
  });

  it("projects transclusion once and terminates a self-reference by stable Node identity", () => {
    const facts = fullDomainScenario().filter(
      (fact) => !["d-move-child", "p-text", "p-schema"].includes(fact.id),
    );
    const { factFirst, hybrid } = loadBoth(facts);

    const expected = [
      "Workspace [n-root]",
      "  Shared [n-shared]",
      "    Child [n-child]",
      "    ↻ Shared [n-shared]",
      "  Shared [n-shared]",
      "    Child [n-child]",
      "    ↻ Shared [n-shared]",
    ];
    expect(outlineFromOccurrence(factFirst.review(), "o-root")).toEqual(expected);
    expect(outlineFromOccurrence(hybrid.review(), "o-root")).toEqual(expected);
  });

  it("keeps incremental caches equivalent to a full rebuild under reverse fact arrival", () => {
    const facts = [
      ...fullDomainScenario(),
      resolution("r-text-accept", 30, "reviewer", "p-text", "accept"),
      resolution("r-schema-reject", 31, "reviewer", "p-schema", "reject"),
    ];
    const factFirst = new FactFirstAuthority();
    for (const fact of [...facts].reverse()) factFirst.ingest(fact);

    expect(visible(factFirst.origin())).toEqual(visible(factFirst.rebuildProjection("origin")));
    expect(visible(factFirst.review())).toEqual(visible(factFirst.rebuildProjection("review")));

    const hybrid = new StateReviewAuthority();
    for (const fact of [...facts].reverse()) hybrid.ingest(fact);
    expect(visible(hybrid.origin())).toEqual(visible(factFirst.origin()));
    expect(visible(hybrid.review())).toEqual(visible(factFirst.review()));
  });

  it("converges offline Accept/Reject races and repairs a losing materialization without erasing Direct state", () => {
    const base = [
      contribution("d-node", 1, "seed", "direct", {
        type: "create-node",
        nodeId: "n",
      }),
      contribution("d-blue", 2, "seed", "direct", {
        type: "set-property",
        nodeId: "n",
        key: "color",
        value: "blue",
      }),
      contribution("p-green", 3, "author", "proposal", {
        type: "set-property",
        nodeId: "n",
        key: "color",
        value: "green",
      }),
    ];
    const leftFactFirst = new FactFirstAuthority();
    const rightFactFirst = new FactFirstAuthority();
    const leftHybrid = new StateReviewAuthority();
    const rightHybrid = new StateReviewAuthority();
    for (const model of [leftFactFirst, rightFactFirst, leftHybrid, rightHybrid]) {
      model.ingestAll(base);
    }

    const accepted = resolution("r-accept", 10, "left", "p-green", "accept");
    const laterDirect = contribution("d-red", 11, "left", "direct", {
      type: "set-property",
      nodeId: "n",
      key: "color",
      value: "red",
    });
    const rejected = resolution("r-reject", 12, "right", "p-green", "reject");
    leftFactFirst.ingest(accepted);
    leftFactFirst.ingest(laterDirect);
    leftHybrid.ingest(accepted);
    leftHybrid.ingest(laterDirect);
    rightFactFirst.ingest(rejected);
    rightHybrid.ingest(rejected);

    leftFactFirst.merge(rightFactFirst);
    rightFactFirst.merge(leftFactFirst);
    leftHybrid.merge(rightHybrid);
    rightHybrid.merge(leftHybrid);

    const color = (state: MaterializedState): unknown =>
      visible(state).nodes.find((node) => node.nodeId === "n")?.properties.color;
    for (const model of [leftFactFirst, rightFactFirst, leftHybrid, rightHybrid]) {
      expect(color(model.origin())).toBe("red");
      expect(color(model.review())).toBe("red");
    }
    expect(leftHybrid.stats().materializations).toBeGreaterThan(1);
  });

  it("recovers the state-plus-review Accept saga after each durable crash boundary", () => {
    const hybrid = new StateReviewAuthority();
    hybrid.ingestAll([
      contribution("d-node", 1, "seed", "direct", {
        type: "create-node",
        nodeId: "n",
      }),
      contribution("d-text", 2, "seed", "direct", {
        type: "set-text",
        nodeId: "n",
        value: "Origin",
      }),
      contribution("p-text", 3, "author", "proposal", {
        type: "set-text",
        nodeId: "n",
        value: "Review",
      }),
    ]);
    hybrid.ingest(resolution("r-accept", 4, "reviewer", "p-text", "accept"), false);

    const restarted = StateReviewAuthority.hydrate(hybrid.serialize());
    expect(visible(restarted.origin()).nodes[0]?.text).toBe("Origin");
    expect(visible(restarted.review()).nodes[0]?.text).toBe("Review");

    restarted.healMaterializations();
    const afterFirstHeal = restarted.stats();
    restarted.healMaterializations();
    expect(visible(restarted.origin()).nodes[0]?.text).toBe("Review");
    expect(restarted.stats().materializations).toBe(afterFirstHeal.materializations);

    const restartedAfterMaterialization = StateReviewAuthority.hydrate(restarted.serialize());
    restartedAfterMaterialization.healMaterializations();
    expect(visible(restartedAfterMaterialization.origin()).nodes[0]?.text).toBe("Review");
    expect(restartedAfterMaterialization.stats().materializations).toBe(0);
  });

  it("restarts and fully rebuilds both candidates without changing either projection", () => {
    const facts = [
      ...fullDomainScenario(),
      resolution("r-text-accept", 30, "reviewer", "p-text", "accept"),
      resolution("r-schema-reject", 31, "reviewer", "p-schema", "reject"),
    ];
    const { factFirst, hybrid } = loadBoth(facts);
    const restartedFactFirst = FactFirstAuthority.hydrate(factFirst.serialize());
    const restartedHybrid = StateReviewAuthority.hydrate(hybrid.serialize());

    expect(visible(restartedFactFirst.origin())).toEqual(visible(factFirst.origin()));
    expect(visible(restartedFactFirst.review())).toEqual(visible(factFirst.review()));
    expect(visible(restartedHybrid.origin())).toEqual(visible(hybrid.origin()));
    expect(visible(restartedHybrid.review())).toEqual(visible(hybrid.review()));
  });

  it("requires causal stability and terminal Proposals before compacting either candidate", () => {
    const facts = [
      contribution("d-node", 1, "seed", "direct", {
        type: "create-node",
        nodeId: "n",
      }),
      contribution("p-text", 2, "author", "proposal", {
        type: "set-text",
        nodeId: "n",
        value: "Accepted",
      }),
    ];
    const { factFirst, hybrid } = loadBoth(facts);
    expect(() => factFirst.compact(false)).toThrow(/causal-stability/);
    expect(() => hybrid.compact(false)).toThrow(/causal-stability/);
    expect(() => factFirst.compact(true)).toThrow(/unresolved proposal/);
    expect(() => hybrid.compact(true)).toThrow(/unresolved proposal/);

    const accepted = resolution("r-accept", 3, "reviewer", "p-text", "accept");
    factFirst.ingest(accepted);
    hybrid.ingest(accepted);
    factFirst.compact(true);
    hybrid.compact(true);
    const factFirstAfter = visible(factFirst.origin());
    const hybridAfter = visible(hybrid.origin());

    const staleReject = resolution("r-stale", 4, "offline", "p-text", "reject");
    factFirst.ingest(staleReject);
    hybrid.ingest(staleReject);
    expect(visible(factFirst.origin())).toEqual(factFirstAfter);
    expect(visible(hybrid.origin())).toEqual(hybridAfter);
    expect(visible(factFirst.review())).toEqual(factFirstAfter);
    expect(visible(hybrid.review())).toEqual(hybridAfter);
  });

  it("replays versioned legacy operations alongside the current schema and rejects invalid versions", () => {
    const facts: Fact[] = [
      contribution("d-node", 1, "seed", "direct", {
        type: "create-node",
        nodeId: "n",
      }),
      contribution(
        "legacy-priority",
        2,
        "old-client",
        "direct",
        {
          type: "set-attribute",
          nodeId: "n",
          name: "priority",
          value: 1,
        },
        1,
      ),
      contribution("current-priority", 3, "new-client", "direct", {
        type: "set-property",
        nodeId: "n",
        key: "priority",
        value: 2,
      }),
    ];
    const { factFirst, hybrid } = loadBoth(facts);
    expect(visible(factFirst.origin())).toEqual(visible(hybrid.origin()));
    expect(visible(factFirst.origin()).nodes[0]?.properties.priority).toBe(2);

    const invalid = contribution(
      "invalid",
      4,
      "new-client",
      "direct",
      {
        type: "set-attribute",
        nodeId: "n",
        name: "priority",
        value: 3,
      },
      2,
    );
    expect(() => factFirst.ingest(invalid)).toThrow(/removed set-attribute/);
  });

  it("makes the write-amplification and retained-live-fact costs observable", () => {
    const facts = fullDomainScenario();
    const { factFirst, hybrid } = loadBoth(facts);

    expect(hybrid.stats().durableWrites).toBeGreaterThan(factFirst.stats().durableWrites);
    expect(hybrid.serialize().length).toBeGreaterThan(factFirst.serialize().length);
    expect(hybrid.exportSync(new Set()).length).toBeGreaterThan(
      factFirst.exportSync(new Set()).length,
    );
  });
});
