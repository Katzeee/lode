import {
  frontierOf,
  factActions,
  graphActionBody,
  makeFact,
  type AuthorityReceipt,
  type EditIntent,
  type Fact,
  type FactId,
  type FactAction,
  type FactSnapshot,
  type GraphAction,
  workspaceGenesisActions,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { nextHistoryLineage } from "../../../src/domain/history/state.js";
import { planInvocationCompensation } from "../../../src/domain/history/compensation.js";
import { withInitialNodeRelations } from "../reconcile/placed-node-test-helpers.js";

const REPLICA = "101";
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;
const versions = CURRENT_PROJECTION_VERSIONS;

export class HistoryFixture {
  readonly facts: Fact[] = [];
  readonly receipts: AuthorityReceipt[] = [];

  constructor() {
    this.transaction(workspaceGenesisActions("workspace"));
  }

  fact(authoredAction: GraphAction, intent: EditIntent = "direct"): FactAction {
    const sequence = this.facts.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: graphActionBody("actor", intent, [authoredAction]),
    });
    this.facts.push(fact);
    const action = factActions(fact)[0];
    if (!action) {
      throw new Error("History fixture edit has no FactAction");
    }
    return action;
  }

  resolve(proposalFactIds: readonly FactId[], decision: "accept" | "reject"): Fact {
    const sequence = this.facts.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reviewer",
        decision,
        proposalFactIds,
      },
    });
    this.facts.push(fact);
    return fact;
  }

  step(input: {
    invocationId: string;
    actions: readonly GraphAction[];
    intent?: EditIntent;
    channelId?: string;
    operation?: "normal" | "undo" | "redo";
    targetStepId?: string | null;
  }): AuthorityReceipt {
    const created = this.transaction(input.actions, input.intent);
    const channelId = input.channelId ?? "channel";
    const lineage = nextHistoryLineage(
      this.receipts,
      channelId,
      input.operation ?? "normal",
      input.targetStepId ?? null,
    );
    const receipt: AuthorityReceipt = {
      workspaceId: "workspace",
      replicaId: REPLICA,
      invocationId: input.invocationId,
      requestDigest: `digest-${input.invocationId}`,
      factIds: [...new Set(created.map((fact) => fact.factId))],
      committedFrontier: frontierOf(this.facts),
      lineage,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  addTransaction(actions: readonly GraphAction[], intent: EditIntent = "direct"): readonly FactAction[] {
    return this.transaction(actions, intent);
  }

  compensationActions(invocationId: string): readonly GraphAction[] {
    const receipt = this.receipts.find((candidate) => candidate.invocationId === invocationId);
    if (!receipt) {
      return [];
    }
    const ids = new Set(receipt.factIds);
    const compensation = planInvocationCompensation(
      this.facts.filter((fact) => ids.has(fact.id)),
      this.snapshot(),
      this.generation(),
    );
    return compensation.kind === "ready" ? compensation.writes.flatMap((batch) => batch.actions) : [];
  }

  private transaction(actions: readonly GraphAction[], intent: EditIntent = "direct"): readonly FactAction[] {
    const ownedActions = withInitialNodeRelations(actions);
    const [first, ...rest] = ownedActions;
    if (!first) {
      return [];
    }
    const sequence = this.facts.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: graphActionBody("actor", intent, [first, ...rest]),
    });
    this.facts.push(fact);
    return factActions(fact);
  }

  snapshot(): FactSnapshot {
    return { facts: this.facts, frontier: frontierOf(this.facts) };
  }

  generation(): ProjectionGeneration {
    return rebuildGeneration("workspace", this.snapshot(), versions);
  }
}

export function baseFixture(): HistoryFixture {
  const fixture = new HistoryFixture();
  fixture.addTransaction([
    {
      kind: "node-create",
      nodeId: "node",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "occurrence", anchor: end },
    },
  ]);
  return fixture;
}
