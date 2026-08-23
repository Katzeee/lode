import {
  frontierOf,
  factActions,
  makeFact,
  type AuthorityReceipt,
  type EditIntent,
  type Fact,
  type FactId,
  type FactAction,
  type FactSnapshot,
  type AuthoredAction,
  workspaceGenesisActions,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { nextHistoryLineage } from "../../../src/domain/history/state.js";
import { planCompensation } from "../../../src/domain/history/compensation.js";
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

  fact(authoredAction: AuthoredAction, intent: EditIntent = "direct"): FactAction {
    const sequence = this.facts.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: { kind: "edit", actorId: "actor", intent, actions: [authoredAction] },
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
    actions: readonly AuthoredAction[];
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
    const inverse = this.inverseForStep(created);
    const receipt: AuthorityReceipt = {
      workspaceId: "workspace",
      replicaId: REPLICA,
      invocationId: input.invocationId,
      requestDigest: `digest-${input.invocationId}`,
      factIds: [...new Set(created.map((fact) => fact.factId))],
      committedFrontier: frontierOf(this.facts),
      lineage,
      inverse,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  private inverseForStep(created: readonly FactAction[]): AuthorityReceipt["inverse"] {
    const compensation = planCompensation(created, this.snapshot(), this.generation());
    if (compensation.kind !== "ready") {
      return [];
    }
    const [first, ...rest] = compensation.actions;
    return first ? [{ intent: created[0]?.intent ?? "direct", actions: [first, ...rest] }] : [];
  }

  addTransaction(actions: readonly AuthoredAction[], intent: EditIntent = "direct"): readonly FactAction[] {
    return this.transaction(actions, intent);
  }

  inverseActions(invocationId: string): readonly AuthoredAction[] {
    return (
      this.receipts
        .find((receipt) => receipt.invocationId === invocationId)
        ?.inverse.flatMap((batch) => batch.actions) ?? []
    );
  }

  private transaction(actions: readonly AuthoredAction[], intent: EditIntent = "direct"): readonly FactAction[] {
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
      body: { kind: "edit", actorId: "actor", intent, actions: [first, ...rest] },
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
