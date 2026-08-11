export type ViewMode = "origin" | "review";

export type DomainOperation =
  | { type: "create-node"; nodeId: string }
  | { type: "insert-text"; nodeId: string; text: string }
  | { type: "create-occurrence"; occurrenceId: string; nodeId: string; parentId: string }
  | { type: "move-occurrence"; occurrenceId: string; parentId: string }
  | { type: "delete-occurrence"; occurrenceId: string }
  | { type: "set-property"; nodeId: string; key: string; value: unknown };

export type ContributionFact = {
  kind: "contribution";
  id: string;
  order: number;
  intent: "direct" | "proposal";
  operation: DomainOperation | { type: string; [key: string]: unknown };
};

export type ResolutionFact = {
  kind: "resolution";
  id: string;
  order: number;
  proposalId: string;
  decision: "accept" | "reject";
};

export type Fact = ContributionFact | ResolutionFact;

export type OccurrenceState = {
  occurrenceId: string;
  nodeId: string;
  parentId: string;
};

export type Baseline = {
  nodes: ReadonlySet<string>;
  texts: ReadonlyMap<string, string>;
  occurrences: ReadonlyMap<string, OccurrenceState>;
  properties: ReadonlyMap<string, unknown>;
};

export type ReconcileContext = ReadonlyMap<string, unknown>;

export type Rule = {
  id: string;
  owner: string;
  after: readonly string[];
  reads: readonly string[];
  writes: readonly string[];
  run(context: ReconcileContext): ReadonlyMap<string, unknown>;
};

const BASE_KEYS = new Set(["facts", "mode", "baseline"]);

export class RuleGraph {
  private readonly ordered: Rule[];

  constructor(rules: readonly Rule[]) {
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    if (byId.size !== rules.length) throw new Error("duplicate rule id");
    for (const rule of rules) {
      for (const dependency of rule.after) {
        if (!byId.has(dependency)) throw new Error(`${rule.id}: missing dependency ${dependency}`);
      }
    }
    this.ordered = topologicalOrder(byId);
    validateDataflow(this.ordered);
  }

  reconcile(input: {
    facts: readonly Fact[];
    mode: ViewMode;
    baseline: Baseline;
  }): ReconcileContext {
    const context = new Map<string, unknown>([
      ["facts", [...input.facts].sort(compareFacts)],
      ["mode", input.mode],
      ["baseline", input.baseline],
    ]);
    for (const rule of this.ordered) {
      const patch = rule.run(context);
      for (const key of patch.keys()) {
        if (!rule.writes.includes(key)) throw new Error(`${rule.id}: undeclared output ${key}`);
        if (context.has(key)) throw new Error(`${rule.id}: output collision on ${key}`);
      }
      for (const key of rule.writes) {
        if (!patch.has(key)) throw new Error(`${rule.id}: missing declared output ${key}`);
      }
      for (const [key, value] of patch) context.set(key, value);
    }
    return context;
  }
}

function topologicalOrder(byId: ReadonlyMap<string, Rule>): Rule[] {
  const result: Rule[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`rule dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const rule = byId.get(id)!;
    for (const dependency of [...rule.after].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    result.push(rule);
  };
  for (const id of [...byId.keys()].sort()) visit(id);
  return result;
}

function validateDataflow(rules: readonly Rule[]): void {
  const available = new Set(BASE_KEYS);
  for (const rule of rules) {
    for (const key of rule.reads) {
      if (!available.has(key)) throw new Error(`${rule.id}: input ${key} has no earlier producer`);
    }
    for (const key of rule.writes) {
      if (available.has(key)) throw new Error(`${rule.id}: duplicate producer for ${key}`);
      available.add(key);
    }
  }
}

function compareFacts(left: Fact, right: Fact): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function values<T>(context: ReconcileContext, key: string): T {
  if (!context.has(key)) throw new Error(`missing context value ${key}`);
  return context.get(key) as T;
}

function patch(key: string, value: unknown): ReadonlyMap<string, unknown> {
  return new Map([[key, value]]);
}

export const activationRule: Rule = {
  id: "review.activation",
  owner: "review",
  after: [],
  reads: ["facts", "mode"],
  writes: ["candidateContributions"],
  run(context) {
    const facts = values<readonly Fact[]>(context, "facts");
    const mode = values<ViewMode>(context, "mode");
    const resolutions = new Map<string, ResolutionFact>();
    for (const fact of facts) {
      if (fact.kind !== "resolution") continue;
      const current = resolutions.get(fact.proposalId);
      if (!current || compareFacts(current, fact) < 0) resolutions.set(fact.proposalId, fact);
    }
    const candidates = facts.filter((fact): fact is ContributionFact => {
      if (fact.kind !== "contribution") return false;
      if (fact.intent === "direct") return true;
      const decision = resolutions.get(fact.id)?.decision;
      if (decision === "reject") return false;
      return mode === "review" || decision === "accept";
    });
    return patch("candidateContributions", candidates);
  },
};

export const nodeSupportRule: Rule = {
  id: "node.support-policy",
  owner: "node",
  after: ["review.activation"],
  reads: ["baseline", "facts"],
  writes: ["nodeSupportEdges"],
  run(context) {
    const baseline = values<Baseline>(context, "baseline");
    const facts = values<readonly Fact[]>(context, "facts");
    const proposalCreators = new Map<string, string>();
    for (const fact of facts) {
      if (
        fact.kind === "contribution" &&
        fact.intent === "proposal" &&
        fact.operation.type === "create-node"
      ) {
        proposalCreators.set(fact.operation.nodeId as string, fact.id);
      }
    }
    const edges = new Map<string, ReadonlySet<string>>();
    for (const fact of facts) {
      if (fact.kind !== "contribution" || fact.intent !== "direct") continue;
      const nodeId =
        "nodeId" in fact.operation && typeof fact.operation.nodeId === "string"
          ? fact.operation.nodeId
          : undefined;
      const creator =
        nodeId && !baseline.nodes.has(nodeId) ? proposalCreators.get(nodeId) : undefined;
      if (creator) edges.set(fact.id, new Set([creator]));
    }
    return patch("nodeSupportEdges", edges);
  },
};

export function structureSupportRule(removalPolicy: "cascade" | "rehome"): Rule {
  return {
    id: "structure.support-policy",
    owner: "occurrence",
    after: ["review.activation"],
    reads: ["facts"],
    writes: ["structureSupportEdges"],
    run(context) {
      const facts = values<readonly Fact[]>(context, "facts");
      const proposalOccurrenceCreators = new Map<string, string>();
      for (const fact of facts) {
        if (
          fact.kind === "contribution" &&
          fact.intent === "proposal" &&
          fact.operation.type === "create-occurrence"
        ) {
          proposalOccurrenceCreators.set(fact.operation.occurrenceId as string, fact.id);
        }
      }
      const edges = new Map<string, ReadonlySet<string>>();
      if (removalPolicy === "cascade") {
        for (const fact of facts) {
          if (
            fact.kind !== "contribution" ||
            fact.intent !== "direct" ||
            fact.operation.type !== "create-occurrence"
          ) {
            continue;
          }
          const creator = proposalOccurrenceCreators.get(fact.operation.parentId as string);
          if (creator) edges.set(fact.id, new Set([creator]));
        }
      }
      return patch("structureSupportEdges", edges);
    },
  };
}

export const closureRule: Rule = {
  id: "review.effective-closure",
  owner: "review",
  after: ["node.support-policy", "structure.support-policy"],
  reads: ["candidateContributions", "nodeSupportEdges", "structureSupportEdges"],
  writes: ["activeContributions"],
  run(context) {
    const candidates = values<readonly ContributionFact[]>(context, "candidateContributions");
    const candidateIds = new Set(candidates.map((fact) => fact.id));
    const edgeMaps = [
      values<ReadonlyMap<string, ReadonlySet<string>>>(context, "nodeSupportEdges"),
      values<ReadonlyMap<string, ReadonlySet<string>>>(context, "structureSupportEdges"),
    ];
    const dependencies = new Map<string, Set<string>>();
    for (const edgeMap of edgeMaps) {
      for (const [dependent, supports] of edgeMap) {
        const current = dependencies.get(dependent) ?? new Set<string>();
        for (const support of supports) current.add(support);
        dependencies.set(dependent, current);
      }
    }
    const active = candidates.filter((fact) =>
      [...(dependencies.get(fact.id) ?? [])].every((support) => candidateIds.has(support)),
    );
    return patch("activeContributions", active);
  },
};

export const nodeRule: Rule = {
  id: "node.reconcile",
  owner: "node",
  after: ["review.effective-closure"],
  reads: ["baseline", "activeContributions"],
  writes: ["nodes"],
  run(context) {
    const baseline = values<Baseline>(context, "baseline");
    const active = values<readonly ContributionFact[]>(context, "activeContributions");
    const nodes = new Set(baseline.nodes);
    for (const fact of active) {
      if (fact.operation.type === "create-node") nodes.add(fact.operation.nodeId as string);
    }
    return patch("nodes", nodes);
  },
};

export const textRule: Rule = {
  id: "text.reconcile",
  owner: "text",
  after: ["node.reconcile"],
  reads: ["baseline", "nodes", "activeContributions"],
  writes: ["texts"],
  run(context) {
    const baseline = values<Baseline>(context, "baseline");
    const nodes = values<ReadonlySet<string>>(context, "nodes");
    const active = values<readonly ContributionFact[]>(context, "activeContributions");
    const texts = new Map(baseline.texts);
    for (const fact of active) {
      if (fact.operation.type !== "insert-text") continue;
      const nodeId = fact.operation.nodeId as string;
      if (nodes.has(nodeId)) texts.set(nodeId, `${texts.get(nodeId) ?? ""}${fact.operation.text}`);
    }
    return patch("texts", texts);
  },
};

export const occurrenceRule: Rule = {
  id: "occurrence.reconcile",
  owner: "occurrence",
  after: ["node.reconcile"],
  reads: ["baseline", "nodes", "activeContributions"],
  writes: ["occurrences"],
  run(context) {
    const baseline = values<Baseline>(context, "baseline");
    const nodes = values<ReadonlySet<string>>(context, "nodes");
    const active = values<readonly ContributionFact[]>(context, "activeContributions");
    const occurrences = new Map(baseline.occurrences);
    for (const fact of active) {
      const operation = fact.operation;
      if (operation.type === "create-occurrence" && nodes.has(operation.nodeId as string)) {
        occurrences.set(operation.occurrenceId as string, {
          occurrenceId: operation.occurrenceId as string,
          nodeId: operation.nodeId as string,
          parentId: operation.parentId as string,
        });
      } else if (operation.type === "move-occurrence") {
        const current = occurrences.get(operation.occurrenceId as string);
        if (current) {
          occurrences.set(current.occurrenceId, {
            ...current,
            parentId: operation.parentId as string,
          });
        }
      } else if (operation.type === "delete-occurrence") {
        occurrences.delete(operation.occurrenceId as string);
      }
    }
    return patch("occurrences", occurrences);
  },
};

export const propertyRule: Rule = {
  id: "property.reconcile",
  owner: "property",
  after: ["node.reconcile"],
  reads: ["baseline", "nodes", "activeContributions"],
  writes: ["properties"],
  run(context) {
    const baseline = values<Baseline>(context, "baseline");
    const nodes = values<ReadonlySet<string>>(context, "nodes");
    const active = values<readonly ContributionFact[]>(context, "activeContributions");
    const properties = new Map(baseline.properties);
    for (const fact of active) {
      if (fact.operation.type !== "set-property") continue;
      const nodeId = fact.operation.nodeId as string;
      if (nodes.has(nodeId)) {
        properties.set(`${nodeId}:${fact.operation.key as string}`, fact.operation.value);
      }
    }
    return patch("properties", properties);
  },
};

export function standardRules(removalPolicy: "cascade" | "rehome" = "cascade"): Rule[] {
  return [
    activationRule,
    nodeSupportRule,
    structureSupportRule(removalPolicy),
    closureRule,
    nodeRule,
    textRule,
    occurrenceRule,
    propertyRule,
  ];
}

export function readOutput<T>(context: ReconcileContext, key: string): T {
  return values<T>(context, key);
}
