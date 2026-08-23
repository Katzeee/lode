import {
  frontierOf,
  factActions,
  makeFact,
  type Fact,
  type FactAction,
  type FactBody,
  type FactSnapshot,
  type AuthoredAction,
  workspaceGenesisActions,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../src/domain/reconcile/index.js";
import { withInitialNodeRelations } from "../reconcile/placed-node-test-helpers.js";

export const REPLICA_A = "101";
export const REPLICA_B = "202";
export const REPLICA_C = "303";
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
    this.addTransaction(workspaceGenesisActions("workspace"));
  }

  add(authoredAction: AuthoredAction, intent: "direct" | "proposal" = "direct"): FactAction {
    const action = this.addTransaction([authoredAction], intent)[0];
    if (!action) {
      throw new Error("Review fixture edit has no FactAction");
    }
    return action;
  }

  addTransaction(actions: readonly AuthoredAction[], intent: "direct" | "proposal" = "direct"): readonly FactAction[] {
    const preparedActions = withInitialNodeRelations(actions);
    const [first, ...rest] = preparedActions;
    return first
      ? factActions(this.addBody({ kind: "edit", actorId: "actor", intent, actions: [first, ...rest] }))
      : [];
  }

  applySupertag(
    hostNodeId: string,
    supertagId: string,
    intent: "direct" | "proposal" = "direct",
  ): readonly FactAction[] {
    return this.addTransaction(
      [
        {
          kind: "supertag-application-add",
          hostNodeId,
          supertagId,
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
  ): readonly FactAction[] {
    return this.addTransaction(
      withInitialNodeRelations([
        { kind: "node-create", nodeId, ownerNodeId: parentNodeId, originalPlacement: null },
        { kind: "placement-create", placementId: occurrenceId, nodeId, parentNodeId, anchor: end },
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
    const facts: Fact[] = [];
    for (const body of bodies) {
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
      facts.push(fact);
    }
    return facts;
  }
}

export function base(): ReviewFacts {
  const facts = new ReviewFacts();
  facts.addTransaction([
    { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
    {
      kind: "placement-create",
      placementId: "occurrence",
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
