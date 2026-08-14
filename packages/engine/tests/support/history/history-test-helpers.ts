import {
  frontierOf,
  makeFact,
  type AuthorityReceipt,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type Mutation,
} from "../../../src/domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { nextHistoryLineage } from "../../../src/domain/history/state.js";

export const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;
export const versions = {
  rulesVersion: "proposal-rules-5",
  schemaVersion: "lode-schema-19",
} as const;

export class HistoryFixture {
  readonly facts: Fact[] = [];
  readonly receipts: AuthorityReceipt[] = [];

  constructor() {
    this.fact({ kind: "node-create", nodeId: "workspace" });
  }

  fact(mutation: Mutation, intent: EditIntent = "direct"): Fact {
    const sequence = this.facts.length + 1;
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence,
      observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
      lamport: sequence,
      body: { kind: "contribution", actorId: "actor", intent, mutation },
    });
    this.facts.push(fact);
    return fact;
  }

  resolve(targets: readonly string[], decision: "accept" | "reject"): Fact {
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
        proposalContributionIds: targets,
      },
    });
    this.facts.push(fact);
    return fact;
  }

  step(input: {
    invocationId: string;
    mutations: readonly Mutation[];
    intent?: EditIntent;
    channelId?: string;
    operation?: "normal" | "undo" | "redo";
    targetStepId?: string | null;
  }): AuthorityReceipt {
    const created = input.mutations.map((mutation) => this.fact(mutation, input.intent));
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
      factIds: created.map((fact) => fact.id),
      committedFrontier: frontierOf(this.facts),
      lineage,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  snapshot(): FactSnapshot {
    return { facts: this.facts, frontier: frontierOf(this.facts) };
  }

  generation(): ProjectionGeneration {
    return rebuildGeneration("workspace", this.snapshot(), versions).generation;
  }
}

export function baseFixture(): HistoryFixture {
  const fixture = new HistoryFixture();
  fixture.fact({ kind: "node-create", nodeId: "node" });
  fixture.fact({
    kind: "occurrence-create",
    occurrenceId: "occurrence",
    nodeId: "node",
    parentNodeId: "workspace",
    anchor: end,
  });
  return fixture;
}
