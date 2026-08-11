import { describe, expect, it } from "vitest";
import {
  GlobalWorklistScheduler,
  LoroFactStore,
  OwnerDataflowScheduler,
  PhaseDagScheduler,
  contribution,
  decodeSchedulerCheckpoint,
  encodeSchedulerCheckpoint,
  renderOutline,
  resolution,
  schedulerCandidates,
  standardRules,
  type Fact,
  type FactSnapshot,
  type Projection,
  type ReconcileScheduler,
  type Rule,
  type SchedulerResult,
} from "./reconcile-model.js";

function fullDomainScenario(): Fact[] {
  return [
    contribution("d-root", 1, "seed", "direct", {
      type: "create-node",
      nodeId: "n-root",
    }),
    contribution("d-root-occ", 2, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-root",
      nodeId: "n-root",
      parentOccurrenceId: null,
      position: "a",
      canonical: true,
    }),
    contribution("d-root-text", 3, "seed", "direct", {
      type: "set-text",
      nodeId: "n-root",
      value: "Workspace",
    }),
    contribution("d-shared", 4, "seed", "direct", {
      type: "create-node",
      nodeId: "n-shared",
    }),
    contribution("d-shared-occ-a", 5, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-shared-a",
      nodeId: "n-shared",
      parentOccurrenceId: "o-root",
      position: "a",
      canonical: true,
    }),
    contribution("d-shared-occ-b", 6, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-shared-b",
      nodeId: "n-shared",
      parentOccurrenceId: "o-root",
      position: "b",
      canonical: false,
    }),
    contribution("d-shared-text", 7, "seed", "direct", {
      type: "set-text",
      nodeId: "n-shared",
      value: "Shared",
    }),
    contribution("d-shared-mark", 8, "seed", "direct", {
      type: "add-mark",
      nodeId: "n-shared",
      mark: { id: "m-bold", from: 0, to: 6, kind: "bold" },
    }),
    contribution("d-shared-property", 9, "seed", "direct", {
      type: "set-property",
      nodeId: "n-shared",
      key: "color",
      value: "blue",
    }),
    contribution("d-shared-schema", 10, "seed", "direct", {
      type: "apply-schema",
      nodeId: "n-shared",
      schemaId: "task",
      managedFields: ["status", "owner"],
    }),
    contribution("d-child", 11, "seed", "direct", {
      type: "create-node",
      nodeId: "n-child",
    }),
    contribution("d-child-occ", 12, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-child",
      nodeId: "n-child",
      parentOccurrenceId: "o-shared-a",
      position: "a",
      canonical: true,
    }),
    contribution("d-child-text", 13, "seed", "direct", {
      type: "set-text",
      nodeId: "n-child",
      value: "Child",
    }),
    contribution("d-self-reference", 14, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-self-reference",
      nodeId: "n-shared",
      parentOccurrenceId: "o-shared-a",
      position: "b",
      canonical: false,
    }),
    contribution("d-move-child", 15, "seed", "direct", {
      type: "move-occurrence",
      occurrenceId: "o-child",
      parentOccurrenceId: "o-root",
      position: "c",
    }),
    contribution("d-temp", 16, "seed", "direct", {
      type: "create-node",
      nodeId: "n-temp",
    }),
    contribution("d-temp-occ", 17, "seed", "direct", {
      type: "create-occurrence",
      occurrenceId: "o-temp",
      nodeId: "n-temp",
      parentOccurrenceId: "o-root",
      position: "d",
      canonical: true,
    }),
    contribution("d-delete-temp-occ", 18, "seed", "direct", {
      type: "delete-occurrence",
      occurrenceId: "o-temp",
      policy: "cascade",
    }),
    contribution("d-delete-temp", 19, "seed", "direct", {
      type: "delete-node",
      nodeId: "n-temp",
    }),
    contribution("p-new-node", 20, "author", "proposal", {
      type: "create-node",
      nodeId: "n-proposed",
    }),
    contribution(
      "d-dependent-text",
      21,
      "editor",
      "direct",
      { type: "set-text", nodeId: "n-proposed", value: "Needs proposed node" },
      ["p-new-node"],
    ),
    contribution(
      "p-new-occ",
      22,
      "author",
      "proposal",
      {
        type: "create-occurrence",
        occurrenceId: "o-proposed",
        nodeId: "n-proposed",
        parentOccurrenceId: "o-root",
        position: "e",
        canonical: true,
      },
      ["p-new-node"],
    ),
    contribution("p-shared-text", 23, "author", "proposal", {
      type: "set-text",
      nodeId: "n-shared",
      value: "Shared proposal",
    }),
    contribution("p-rehome-shared", 24, "author", "proposal", {
      type: "delete-occurrence",
      occurrenceId: "o-shared-b",
      policy: "rehome",
    }),
  ];
}

function snapshotOf(facts: readonly Fact[]): FactSnapshot {
  const store = new LoroFactStore();
  store.appendAll(facts);
  return store.snapshot();
}

function projection(
  scheduler: ReconcileScheduler,
  facts: readonly Fact[],
  mode: "origin" | "review",
): Projection {
  return scheduler.rebuild(snapshotOf(facts), mode).projection;
}

function projectAll(facts: readonly Fact[], mode: "origin" | "review"): readonly Projection[] {
  const snapshot = snapshotOf(facts);
  return schedulerCandidates().map((scheduler) => scheduler.rebuild(snapshot, mode).projection);
}

function expectCandidatesEqual(results: readonly Projection[]): void {
  expect(results).toHaveLength(3);
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
}

describe("scheduler candidates over production-shaped Proposal facts", () => {
  it("derives the same Origin and Review across the complete mutation surface", () => {
    const facts = fullDomainScenario();
    const origins = projectAll(facts, "origin");
    const reviews = projectAll(facts, "review");
    expectCandidatesEqual(origins);
    expectCandidatesEqual(reviews);

    const originShared = origins[0]!.nodes.find((node) => node.nodeId === "n-shared");
    const reviewShared = reviews[0]!.nodes.find((node) => node.nodeId === "n-shared");
    expect(originShared).toMatchObject({
      text: "Shared",
      properties: { color: "blue" },
      schemas: ["task"],
    });
    expect(originShared?.marks).toEqual([{ id: "m-bold", from: 0, to: 6, kind: "bold" }]);
    expect(reviewShared?.text).toBe("Shared proposal");
    expect(origins[0]!.nodes.some((node) => node.nodeId === "n-proposed")).toBe(false);
    expect(reviews[0]!.nodes.find((node) => node.nodeId === "n-proposed")?.text).toBe(
      "Needs proposed node",
    );
    expect(
      reviews[0]!.nodes
        .filter((node) => node.managed)
        .map((node) => node.properties.field)
        .sort(),
    ).toEqual(["owner", "status"]);

    const mutationTypes = new Set(
      facts.filter((fact) => fact.kind === "contribution").map((fact) => fact.mutation.type),
    );
    expect(mutationTypes).toEqual(
      new Set([
        "create-node",
        "delete-node",
        "set-text",
        "add-mark",
        "set-property",
        "apply-schema",
        "create-occurrence",
        "move-occurrence",
        "delete-occurrence",
      ]),
    );
  });

  it("uses one rule set for Origin and Review and terminates semantic self-reference", () => {
    const facts = fullDomainScenario().filter((fact) => fact.id !== "d-move-child");
    for (const scheduler of schedulerCandidates()) {
      const review = projection(scheduler, facts, "review");
      expect(renderOutline(review, "o-root")).toContain("    ↻ Shared proposal [n-shared]");
      const origin = projection(scheduler, facts, "origin");
      expect(renderOutline(origin, "o-root")).toContain("    ↻ Shared [n-shared]");
    }
  });

  it("converges Loro replicas after concurrent neutral Accept/Reject decisions", () => {
    const base = fullDomainScenario();
    const left = new LoroFactStore();
    const right = new LoroFactStore();
    left.appendAll(base);
    right.import(left.exportSnapshot());

    left.append(resolution("r-accept", 30, "left", ["p-shared-text"], "accept"));
    right.append(resolution("r-reject", 30, "right", ["p-shared-text"], "reject"));
    left.import(right.exportSnapshot());
    right.import(left.exportSnapshot());

    expect(left.snapshot()).toEqual(right.snapshot());
    for (const scheduler of schedulerCandidates()) {
      expect(scheduler.rebuild(left.snapshot(), "origin").projection).toEqual(
        scheduler.rebuild(right.snapshot(), "origin").projection,
      );
      expect(
        scheduler
          .rebuild(left.snapshot(), "origin")
          .projection.nodes.find((node) => node.nodeId === "n-shared")?.text,
      ).toBe("Shared");
    }
  });

  it("is deterministic under reverse fact arrival and reverse rule registration", () => {
    const facts = [
      ...fullDomainScenario(),
      resolution("r-text-accept", 31, "reviewer", ["p-shared-text"], "accept"),
      resolution("r-node-reject", 32, "reviewer", ["p-new-node"], "reject"),
    ];
    const forward = snapshotOf(facts);
    const reverse = snapshotOf([...facts].reverse());
    const schedulers: ReconcileScheduler[] = [
      new PhaseDagScheduler([...standardRules()].reverse()),
      new GlobalWorklistScheduler([...standardRules()].reverse()),
      new OwnerDataflowScheduler([...standardRules()].reverse()),
    ];
    for (const scheduler of schedulers) {
      expect(scheduler.rebuild(reverse, "review").projection).toEqual(
        scheduler.rebuild(forward, "review").projection,
      );
    }
  });

  it("keeps persisted checkpoint plus tail equivalent to full rebuild", () => {
    const base = fullDomainScenario();
    const tail: Fact[] = [
      contribution("d-tail-property", 40, "editor", "direct", {
        type: "set-property",
        nodeId: "n-shared",
        key: "priority",
        value: "high",
      }),
      resolution("r-tail-accept", 41, "reviewer", ["p-shared-text"], "accept"),
    ];
    const baseSnapshot = snapshotOf(base);
    const finalSnapshot = snapshotOf([...tail, ...base].reverse());

    for (const scheduler of schedulerCandidates()) {
      const initial = scheduler.rebuild(baseSnapshot, "review");
      const persisted = decodeSchedulerCheckpoint(encodeSchedulerCheckpoint(initial.checkpoint));
      const incremental = scheduler.advance(persisted, finalSnapshot);
      const rebuilt = scheduler.rebuild(finalSnapshot, "review");
      expect(incremental.projection).toEqual(rebuilt.projection);
      expect(incremental.checkpoint.snapshot.frontier).toEqual(finalSnapshot.frontier);
    }
  });

  it("is idempotent for duplicate facts and repairs reverse-order support arrival", () => {
    const dependent = contribution(
      "d-dependent",
      2,
      "editor",
      "direct",
      { type: "set-text", nodeId: "n", value: "available" },
      ["p-node"],
    );
    const support = contribution("p-node", 1, "author", "proposal", {
      type: "create-node",
      nodeId: "n",
    });
    const store = new LoroFactStore();
    store.append(dependent);
    store.append(dependent);
    const before = store.snapshot();
    expect(before.facts).toHaveLength(1);

    for (const scheduler of schedulerCandidates()) {
      const initial = scheduler.rebuild(before, "review");
      expect(initial.projection.nodes).toEqual([]);
      store.append(support);
      expect(
        scheduler
          .advance(initial.checkpoint, store.snapshot())
          .projection.nodes.find((node) => node.nodeId === "n")?.text,
      ).toBe("available");
    }
  });
});

describe("composition, ownership, and failure boundaries", () => {
  it("fails closed on missing dependencies, cross-owner writes, and illegal cycles", () => {
    const base: Rule = {
      id: "a",
      owner: "a",
      output: "a",
      after: [],
      evaluate: () => true,
    };
    for (const Scheduler of [PhaseDagScheduler, GlobalWorklistScheduler, OwnerDataflowScheduler]) {
      expect(() => new Scheduler([{ ...base, after: ["missing"] }])).toThrow(
        /missing rule dependency/,
      );
      expect(() => new Scheduler([base, { ...base, id: "b", owner: "b", output: "a" }])).toThrow(
        /duplicate output/,
      );
      expect(
        () =>
          new Scheduler([
            { ...base, output: "a", after: ["b"] },
            { ...base, id: "b", owner: "b", output: "b", after: ["a"] },
          ]),
      ).toThrow(/illegal rule cycle/);
    }
  });

  it("fails closed on invalid text ranges and stored occurrence cycles", () => {
    const invalidMark: Fact[] = [
      contribution("d-node", 1, "a", "direct", {
        type: "create-node",
        nodeId: "n",
      }),
      contribution("d-text", 2, "a", "direct", {
        type: "set-text",
        nodeId: "n",
        value: "short",
      }),
      contribution("d-mark", 3, "a", "direct", {
        type: "add-mark",
        nodeId: "n",
        mark: { id: "m", from: 0, to: 20, kind: "bold" },
      }),
    ];
    const cycle: Fact[] = [
      contribution("d-a", 1, "a", "direct", {
        type: "create-node",
        nodeId: "a",
      }),
      contribution("d-b", 2, "a", "direct", {
        type: "create-node",
        nodeId: "b",
      }),
      contribution("d-oa", 3, "a", "direct", {
        type: "create-occurrence",
        occurrenceId: "oa",
        nodeId: "a",
        parentOccurrenceId: "ob",
        position: "a",
        canonical: true,
      }),
      contribution("d-ob", 4, "a", "direct", {
        type: "create-occurrence",
        occurrenceId: "ob",
        nodeId: "b",
        parentOccurrenceId: "oa",
        position: "a",
        canonical: true,
      }),
    ];
    for (const scheduler of schedulerCandidates()) {
      expect(() => scheduler.rebuild(snapshotOf(invalidMark), "origin")).toThrow(
        /invalid text mark/,
      );
      expect(() => scheduler.rebuild(snapshotOf(cycle), "origin")).toThrow(
        /stored occurrence cycle/,
      );
    }
  });

  it("adds or removes a domain-owned rule without changing undeclared outputs", () => {
    const auditRule: Rule = {
      id: "audit.contribution-count",
      owner: "audit",
      output: "audit-count",
      after: ["activation"],
      evaluate: (context) => context.facts.filter((fact) => fact.kind === "contribution").length,
    };
    const facts = snapshotOf(fullDomainScenario());
    const without = new OwnerDataflowScheduler().rebuild(facts, "review");
    const withRule = new OwnerDataflowScheduler([...standardRules(), auditRule]).rebuild(
      facts,
      "review",
    );

    expect(withRule.projection).toEqual(without.projection);
    expect(new Map(withRule.checkpoint.values).get("audit-count")).toBe(24);
  });

  it("limits a local text append to the activation, text, and assembly owners", () => {
    const scheduler = new OwnerDataflowScheduler();
    const base = fullDomainScenario();
    const initial = scheduler.rebuild(snapshotOf(base), "origin");
    const tail = contribution("d-text-tail", 50, "editor", "direct", {
      type: "set-text",
      nodeId: "n-root",
      value: "Workspace updated",
    });
    const advanced = scheduler.advance(initial.checkpoint, snapshotOf([...base, tail]));

    expect(advanced.stats.evaluationsByRule).toEqual({
      "projection.assemble": 1,
      "review.activation-and-support-closure": 1,
      "text.materialize": 1,
    });
    expect(advanced.projection.nodes.find((node) => node.nodeId === "n-root")?.text).toBe(
      "Workspace updated",
    );
  });
});
