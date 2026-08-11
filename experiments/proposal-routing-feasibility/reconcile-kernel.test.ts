import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  RuleGraph,
  readOutput,
  standardRules,
  type Baseline,
  type ContributionFact,
  type Fact,
  type ReconcileContext,
  type Rule,
} from "./reconcile-kernel.js";

const baseline: Baseline = {
  nodes: new Set(["n-root", "n-existing"]),
  texts: new Map([
    ["n-root", "Workspace"],
    ["n-existing", "年度"],
  ]),
  occurrences: new Map([
    ["o-root", { occurrenceId: "o-root", nodeId: "n-root", parentId: "" }],
    ["o-existing", { occurrenceId: "o-existing", nodeId: "n-existing", parentId: "o-root" }],
  ]),
  properties: new Map([["n-existing:color", "blue"]]),
};

const facts: Fact[] = [
  {
    kind: "contribution",
    id: "p-create-node",
    order: 1,
    intent: "proposal",
    operation: { type: "create-node", nodeId: "n-new" },
  },
  {
    kind: "contribution",
    id: "p-create-occ",
    order: 2,
    intent: "proposal",
    operation: {
      type: "create-occurrence",
      occurrenceId: "o-new",
      nodeId: "n-new",
      parentId: "o-root",
    },
  },
  {
    kind: "contribution",
    id: "d-new-text",
    order: 3,
    intent: "direct",
    operation: { type: "insert-text", nodeId: "n-new", text: "Direct content" },
  },
  {
    kind: "contribution",
    id: "p-move",
    order: 4,
    intent: "proposal",
    operation: { type: "move-occurrence", occurrenceId: "o-existing", parentId: "o-new" },
  },
  {
    kind: "contribution",
    id: "p-color",
    order: 5,
    intent: "proposal",
    operation: { type: "set-property", nodeId: "n-existing", key: "color", value: "green" },
  },
  {
    kind: "contribution",
    id: "d-color",
    order: 6,
    intent: "direct",
    operation: { type: "set-property", nodeId: "n-existing", key: "color", value: "red" },
  },
];

function output(context: ReconcileContext): unknown {
  return {
    active: readOutput<ContributionFact[]>(context, "activeContributions").map((fact) => fact.id),
    nodes: [...readOutput<Set<string>>(context, "nodes")].sort(),
    texts: [...readOutput<Map<string, string>>(context, "texts")].sort(),
    occurrences: [...readOutput<Map<string, unknown>>(context, "occurrences")].sort(),
    properties: [...readOutput<Map<string, unknown>>(context, "properties")].sort(),
  };
}

describe("domain-owned rule graph", () => {
  it("derives Origin and Review with one rule set and policy-derived existence dependencies", () => {
    const graph = new RuleGraph(standardRules());

    const origin = graph.reconcile({ facts, mode: "origin", baseline });
    const review = graph.reconcile({ facts, mode: "review", baseline });

    expect(readOutput<Set<string>>(origin, "nodes").has("n-new")).toBe(false);
    expect(readOutput<Map<string, string>>(origin, "texts").has("n-new")).toBe(false);
    expect(
      readOutput<ContributionFact[]>(origin, "activeContributions").map((fact) => fact.id),
    ).toEqual(["d-color"]);

    expect(readOutput<Set<string>>(review, "nodes").has("n-new")).toBe(true);
    expect(readOutput<Map<string, string>>(review, "texts").get("n-new")).toBe("Direct content");
    expect(readOutput<Map<string, unknown>>(review, "properties").get("n-existing:color")).toBe(
      "red",
    );
  });

  it("Reject excludes a Proposal while retaining the later Direct property value", () => {
    const graph = new RuleGraph(standardRules());
    const resolvedFacts: Fact[] = [
      ...facts,
      {
        kind: "resolution",
        id: "r-color-reject",
        order: 7,
        proposalId: "p-color",
        decision: "reject",
      },
    ];

    for (const mode of ["origin", "review"] as const) {
      const result = graph.reconcile({ facts: resolvedFacts, mode, baseline });
      expect(readOutput<Map<string, unknown>>(result, "properties").get("n-existing:color")).toBe(
        "red",
      );
    }
  });

  it("is deterministic when fact arrival and rule registration order differ", () => {
    const forward = new RuleGraph(standardRules());
    const reverse = new RuleGraph([...standardRules()].reverse());
    const shuffledFacts = [facts[4]!, facts[1]!, facts[5]!, facts[0]!, facts[3]!, facts[2]!];

    expect(output(forward.reconcile({ facts, mode: "review", baseline }))).toEqual(
      output(reverse.reconcile({ facts: shuffledFacts, mode: "review", baseline })),
    );
  });

  it("derives structural support from the owning removal policy rather than from references alone", () => {
    const parentAndChildFacts: Fact[] = [
      {
        kind: "contribution",
        id: "p-parent",
        order: 1,
        intent: "proposal",
        operation: {
          type: "create-occurrence",
          occurrenceId: "o-proposal-parent",
          nodeId: "n-existing",
          parentId: "o-root",
        },
      },
      {
        kind: "contribution",
        id: "d-child",
        order: 2,
        intent: "direct",
        operation: {
          type: "create-occurrence",
          occurrenceId: "o-direct-child",
          nodeId: "n-existing",
          parentId: "o-proposal-parent",
        },
      },
    ];
    const cascade = new RuleGraph(standardRules("cascade")).reconcile({
      facts: parentAndChildFacts,
      mode: "origin",
      baseline,
    });
    const rehome = new RuleGraph(standardRules("rehome")).reconcile({
      facts: parentAndChildFacts,
      mode: "origin",
      baseline,
    });

    expect(
      readOutput<Map<string, Set<string>>>(cascade, "structureSupportEdges").get("d-child"),
    ).toEqual(new Set(["p-parent"]));
    expect(
      readOutput<Map<string, Set<string>>>(rehome, "structureSupportEdges").has("d-child"),
    ).toBe(false);
  });

  it("adds a new domain-owned operation without modifying the scheduler or existing rules", () => {
    const tagRule: Rule = {
      id: "tag.reconcile",
      owner: "tag",
      after: ["review.effective-closure"],
      reads: ["activeContributions"],
      writes: ["tags"],
      run(context) {
        const active = readOutput<ContributionFact[]>(context, "activeContributions");
        const tags = new Set(
          active
            .filter((fact) => fact.operation.type === "add-tag" && "tag" in fact.operation)
            .map((fact) => String("tag" in fact.operation ? fact.operation.tag : "")),
        );
        return new Map([["tags", tags]]);
      },
    };
    const tagFact: ContributionFact = {
      kind: "contribution",
      id: "d-tag",
      order: 10,
      intent: "direct",
      operation: { type: "add-tag", tag: "important" },
    };
    const graph = new RuleGraph([...standardRules(), tagRule]);

    const result = graph.reconcile({
      facts: [...facts, tagFact],
      mode: "origin",
      baseline,
    });

    expect(readOutput<Set<string>>(result, "tags")).toEqual(new Set(["important"]));
  });

  it("rejects missing dependencies, cycles, undeclared outputs, and duplicate producers", () => {
    const baseRule: Rule = {
      id: "a",
      owner: "test",
      after: [],
      reads: ["facts"],
      writes: ["a-output"],
      run: () => new Map([["a-output", true]]),
    };
    expect(() => new RuleGraph([{ ...baseRule, after: ["missing"] }])).toThrow(
      /missing dependency/,
    );
    expect(
      () =>
        new RuleGraph([
          { ...baseRule, after: ["b"] },
          { ...baseRule, id: "b", after: ["a"], writes: ["b-output"] },
        ]),
    ).toThrow(/cycle/);
    expect(
      () => new RuleGraph([baseRule, { ...baseRule, id: "b", after: ["a"], writes: ["a-output"] }]),
    ).toThrow(/duplicate producer/);

    const undeclared = new RuleGraph([
      { ...baseRule, run: () => new Map([["not-declared", true]]) },
    ]);
    expect(() => undeclared.reconcile({ facts: [], mode: "origin", baseline })).toThrow(
      /undeclared output/,
    );
  });
});

class LoroFactLog {
  private readonly doc = new LoroDoc();
  private readonly records = this.doc.getList("facts");

  append(fact: Fact): void {
    this.records.push(JSON.stringify(fact));
  }

  facts(): Fact[] {
    return this.records.toArray().map((item) => JSON.parse(String(item)) as Fact);
  }
}

describe("storage adapters feeding one Reconcile kernel", () => {
  it("Same-doc, Overlay, and fact-first placement produce the same domain projection", () => {
    const sameWorkspace = new LoroFactLog();
    const overlayAccepted = new LoroFactLog();
    const overlayPending = new LoroFactLog();
    const factFirst = new LoroFactLog();

    for (const fact of facts) {
      sameWorkspace.append(fact);
      factFirst.append(fact);
      if (fact.kind === "contribution" && fact.intent === "proposal") {
        overlayPending.append(fact);
      } else {
        overlayAccepted.append(fact);
      }
    }

    const graph = new RuleGraph(standardRules());
    const sameResult = output(
      graph.reconcile({ facts: sameWorkspace.facts(), mode: "review", baseline }),
    );
    const overlayResult = output(
      graph.reconcile({
        facts: [...overlayAccepted.facts(), ...overlayPending.facts()],
        mode: "review",
        baseline,
      }),
    );
    const factFirstResult = output(
      graph.reconcile({ facts: factFirst.facts(), mode: "review", baseline }),
    );

    expect(overlayResult).toEqual(sameResult);
    expect(factFirstResult).toEqual(sameResult);
  });
});
