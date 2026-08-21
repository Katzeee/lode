import {
  frontierOf,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
  type Mutation,
  factTransactionId,
  workspaceGenesisMutations,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../src/domain/reconcile/index.js";
import { withInitialOwnerRelations } from "../reconcile/placed-node-test-helpers.js";

export const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REPLICA_C = "cccccccccccccccccccccccccc";
export const versions = CURRENT_PROJECTION_VERSIONS;
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

export class ReviewFacts {
  readonly values: Fact[] = [];

  constructor() {
    this.addTransaction(workspaceGenesisMutations("workspace"));
  }

  add(mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
    return this.addBody({ kind: "contribution", actorId: "actor", intent, mutation });
  }

  addTransaction(mutations: readonly Mutation[], intent: "direct" | "proposal" = "direct"): readonly Fact[] {
    return this.addBodies(
      withInitialOwnerRelations(mutations).map((mutation) => ({
        kind: "contribution" as const,
        actorId: "actor",
        intent,
        mutation,
      })),
    );
  }

  applySupertag(hostNodeId: string, supertagId: string, intent: "direct" | "proposal" = "direct"): readonly Fact[] {
    const stem = `${hostNodeId}-${supertagId}-application`;
    const metanodeId = `${hostNodeId}-metanode`;
    const metanodeExists = this.values.some(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "metanode-attach" &&
        fact.body.mutation.hostNodeId === hostNodeId,
    );
    return this.addTransaction(
      [
        ...(metanodeExists
          ? []
          : ([
              { kind: "node-create", nodeId: metanodeId },
              { kind: "metanode-attach", hostNodeId, metanodeId },
            ] as const)),
        { kind: "node-create", nodeId: stem },
        {
          kind: "occurrence-create",
          occurrenceId: `${stem}-occurrence`,
          nodeId: stem,
          parentNodeId: metanodeId,
          anchor: end,
        },
        {
          kind: "occurrence-create",
          occurrenceId: `${stem}-relation-definition-occurrence`,
          nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
          parentNodeId: stem,
          anchor: end,
        },
        {
          kind: "occurrence-create",
          occurrenceId: `${stem}-definition-occurrence`,
          nodeId: supertagId,
          parentNodeId: stem,
          anchor: end,
        },
        {
          kind: "supertag-apply",
          hostNodeId,
          supertagId,
          applicationNodeId: stem,
          applicationOccurrenceId: `${stem}-occurrence`,
          relationDefinitionOccurrenceId: `${stem}-relation-definition-occurrence`,
          definitionOccurrenceId: `${stem}-definition-occurrence`,
          anchor: end,
        },
      ],
      intent,
    );
  }

  addPlaced(
    nodeId: string,
    parentNodeId = "workspace",
    occurrenceId = `${nodeId}-original`,
    intent: "direct" | "proposal" = "direct",
  ): readonly Fact[] {
    return this.addTransaction(
      withInitialOwnerRelations([
        { kind: "node-create", nodeId },
        { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
      ]),
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
  return rebuildGeneration("workspace", snapshot, selectedVersions);
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
