import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
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
  rulesVersion: "proposal-rules-1",
  schemaVersion: "proposal-schema-1",
} as const;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class ReviewFacts {
  readonly values: Fact[] = [];

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    return this.addBody({ kind: "contribution", actorId: "actor", intent, mutation });
  }

  addBody(body: FactBody): Fact {
    const sequence = this.values.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA_A]: sequence - 1 },
      lamport: sequence,
      body,
    });
    this.values.push(fact);
    return fact;
  }

  snapshot(extra: readonly Fact[] = []): FactSnapshot {
    const facts = [...this.values, ...extra];
    return { facts, frontier: frontierOf(facts) };
  }
}

export function base(): ReviewFacts {
  const facts = new ReviewFacts();
  facts.add({ kind: "node-create", nodeId: "node" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "occurrence",
    nodeId: "node",
    parentOccurrenceId: null,
    parentPolicy: "cascade",
    anchor: end,
  });
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
