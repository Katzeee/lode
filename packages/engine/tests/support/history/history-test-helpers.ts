import {
  END_SEQUENCE_ANCHOR,
  factActions,
  graphActionBody,
  makeFact,
  type EditIntent,
  type Fact,
  type FactId,
  type FactAction,
  type FactSnapshot,
  type GraphAction,
  workspaceGenesisActions,
} from "../../../src/domain/fact/index.js";
import { frontierOf } from "../../../src/domain/fact/frontier.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { historyBody, historySteps, nextHistoryLineage } from "../../../src/domain/history/state.js";
import { planInvocationCompensation } from "../../../src/domain/history/compensation.js";
import { withInitialNodeRelations } from "../reconcile/placed-node-test-helpers.js";

const REPLICA = "101";
export const end = END_SEQUENCE_ANCHOR;
const versions = CURRENT_PROJECTION_VERSIONS;

export class HistoryFixture {
  readonly facts: Fact[] = [];
  private readonly stepIds = new Map<string, FactId>();

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
  }): Readonly<{ stepId: FactId; factIds: readonly FactId[] }> {
    const created = this.transaction(input.actions, input.intent);
    const channelId = input.channelId ?? "channel";
    const targetStepId =
      input.targetStepId === null || input.targetStepId === undefined
        ? null
        : (this.stepIds.get(input.targetStepId) ?? (input.targetStepId as FactId));
    const lineage = nextHistoryLineage(this.snapshot(), channelId, input.operation ?? "normal", targetStepId);
    const actionFactIds = [...new Set(created.map((fact) => fact.factId))];
    const sequence = this.facts.length + 1;
    const step = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: historyBody(lineage, actionFactIds.length),
    });
    this.facts.push(step);
    this.stepIds.set(input.invocationId, step.id);
    return { stepId: step.id, factIds: actionFactIds };
  }

  addTransaction(actions: readonly GraphAction[], intent: EditIntent = "direct"): readonly FactAction[] {
    return this.transaction(actions, intent);
  }

  compensationActions(invocationId: string): readonly GraphAction[] {
    const stepId = this.stepIds.get(invocationId);
    const step = historySteps(this.snapshot()).find((candidate) => candidate.id === stepId);
    if (!step) {
      return [];
    }
    const compensation = planInvocationCompensation(step.actionFacts, this.snapshot(), this.generation());
    return compensation.kind === "ready" ? compensation.writes.flatMap((batch) => batch.actions) : [];
  }

  stepId(invocationId: string): FactId {
    const stepId = this.stepIds.get(invocationId);
    if (!stepId) {
      throw new Error(`History fixture has no Step for ${invocationId}`);
    }
    return stepId;
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
