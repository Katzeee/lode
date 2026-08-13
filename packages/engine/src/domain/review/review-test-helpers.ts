import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
  factTransactionId,
} from "../fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../reconcile/index.js";

export const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REPLICA_C = "cccccccccccccccccccccccccc";
export const versions = {
  rulesVersion: "proposal-rules-3",
  schemaVersion: "lode-schema-16",
} as const;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class ReviewFacts {
  readonly values: Fact[] = [];

  constructor() {
    this.add({ kind: "node-create", nodeId: "workspace" });
  }

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    return this.addBody({ kind: "contribution", actorId: "actor", intent, mutation });
  }

  addTransaction(
    mutations: readonly Mutation[],
    intent: "direct" | "proposal" = "direct",
  ): readonly Fact[] {
    return this.addBodies(
      mutations.map((mutation) => ({
        kind: "contribution" as const,
        actorId: "actor",
        intent,
        mutation,
      })),
    );
  }

  addPlaced(
    nodeId: string,
    parentNodeId = "workspace",
    occurrenceId = `${nodeId}-original`,
    intent: "direct" | "proposal" = "direct",
  ): readonly Fact[] {
    return this.addTransaction(
      [
        { kind: "node-create", nodeId },
        { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
      ],
      intent,
    );
  }

  addBody(body: FactBody): Fact {
    const fact = this.addBodies([body])[0];
    if (!fact) {
      throw new Error("Review fixture Fact body was not created");
    }
    return fact;
  }

  snapshot(extra: readonly Fact[] = []): FactSnapshot {
    const facts = [...this.values, ...extra];
    return { facts, frontier: frontierOf(facts) };
  }

  private addBodies(bodies: readonly FactBody[]): readonly Fact[] {
    const firstSequence = this.values.length + 1;
    const transactionId = factTransactionId("workspace", REPLICA_A, firstSequence);
    const facts = bodies.map((body, index) => {
      const sequence = firstSequence + index;
      return makeFact({
        workspaceId: "workspace",
        replicaId: REPLICA_A,
        sequence,
        observed: sequence === 1 ? {} : { [REPLICA_A]: sequence - 1 },
        lamport: sequence,
        transaction: { transactionId, index, size: bodies.length },
        body,
      });
    });
    this.values.push(...facts);
    return facts;
  }
}

export function base(): ReviewFacts {
  const facts = new ReviewFacts();
  facts.addTransaction([
    { kind: "node-create", nodeId: "node" },
    {
      kind: "occurrence-create",
      occurrenceId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    },
  ]);
  return facts;
}

export function generation(
  snapshot: FactSnapshot,
  selectedVersions: ProjectionVersions = versions,
): ProjectionGeneration {
  return rebuildGeneration("workspace", snapshot, selectedVersions).generation;
}

export function remoteFact(input: {
  replicaId: string;
  sequence?: number;
  observed: Readonly<Record<string, number>>;
  lamport: number;
  body: FactBody;
}): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: input.replicaId,
    sequence: input.sequence ?? 1,
    observed: input.observed,
    lamport: input.lamport,
    body: input.body,
  });
}
