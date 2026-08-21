import {
  frontierOf,
  factTransactionId,
  makeFact,
  type AuthorityReceipt,
  type EditIntent,
  type Fact,
  type FactSnapshot,
  type Mutation,
  workspaceGenesisMutations,
  workspaceTrashNodeId,
} from "../../../src/domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  occurrenceAnchor,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../src/domain/reconcile/index.js";
import { nextHistoryLineage } from "../../../src/domain/history/state.js";
import { withInitialOwnerRelations } from "../reconcile/placed-node-test-helpers.js";

export const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const end = {
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
} as const;
export const versions = CURRENT_PROJECTION_VERSIONS;

export class HistoryFixture {
  readonly facts: Fact[] = [];
  readonly receipts: AuthorityReceipt[] = [];

  constructor() {
    this.transaction(workspaceGenesisMutations("workspace"));
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
    const created = this.transaction(input.mutations, input.intent);
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

  addTransaction(mutations: readonly Mutation[], intent: EditIntent = "direct"): readonly Fact[] {
    return this.transaction(mutations, intent);
  }

  private transaction(mutations: readonly Mutation[], intent: EditIntent = "direct"): readonly Fact[] {
    const ownedMutations = this.withTrashLifecycleRelations(withInitialOwnerRelations(mutations));
    const firstSequence = this.facts.length + 1;
    const transactionId = factTransactionId("workspace", REPLICA, firstSequence);
    const created = ownedMutations.map((mutation, index) => {
      const sequence = firstSequence + index;
      return makeFact({
        workspaceId: "workspace",
        replicaId: REPLICA,
        sequence,
        observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
        lamport: sequence,
        transaction: { transactionId, index, size: ownedMutations.length },
        body: { kind: "contribution", actorId: "actor", intent, mutation },
      });
    });
    this.facts.push(...created);
    return created;
  }

  private withTrashLifecycleRelations(mutations: readonly Mutation[]): readonly Mutation[] {
    if (!mutations.some((mutation) => mutation.kind === "node-delete")) {
      return mutations;
    }
    const projection = this.facts.length === 0 ? null : this.generation().review;
    const owners = new Map<string, string | null>(Object.entries(projection?.nodeOwners ?? {}));
    const placements = new Map(
      Object.values(projection?.occurrences ?? {}).map((occurrence) => [
        occurrence.occurrenceId,
        {
          nodeId: occurrence.nodeId,
          parentNodeId: occurrence.parentNodeId,
          anchor: projection ? occurrenceAnchor(projection, occurrence.occurrenceId) : end,
        },
      ]),
    );
    const trashNodeId = workspaceTrashNodeId("workspace");
    const result: Mutation[] = [];
    for (const mutation of mutations) {
      result.push(mutation);
      if (mutation.kind === "node-owner-set") {
        owners.set(mutation.nodeId, mutation.ownerNodeId);
        continue;
      }
      if (mutation.kind === "occurrence-create") {
        placements.set(mutation.occurrenceId, {
          nodeId: mutation.nodeId,
          parentNodeId: mutation.parentNodeId,
          anchor: mutation.anchor,
        });
        continue;
      }
      if (mutation.kind === "occurrence-move") {
        const placement = placements.get(mutation.occurrenceId);
        if (placement) {
          placements.set(mutation.occurrenceId, {
            ...placement,
            parentNodeId: mutation.parentNodeId,
            anchor: mutation.anchor,
          });
        }
        continue;
      }
      if (mutation.kind !== "node-delete") {
        continue;
      }
      const hasExplicitTrashMove = mutations.some(
        (candidate) =>
          candidate.kind === "node-owner-set" &&
          candidate.nodeId === mutation.nodeId &&
          candidate.ownerNodeId === trashNodeId &&
          candidate.previousOwnerNodeId !== null,
      );
      if (hasExplicitTrashMove) {
        continue;
      }
      const ownerNodeId = owners.get(mutation.nodeId);
      const candidates = [...placements].filter(([, placement]) => placement.nodeId === mutation.nodeId);
      const selected = candidates.find(([, placement]) => placement.parentNodeId === ownerNodeId) ?? candidates[0];
      if (!ownerNodeId || !selected) {
        continue;
      }
      const [occurrenceId, placement] = selected;
      const ownerChange: Mutation = {
        kind: "node-owner-set",
        nodeId: mutation.nodeId,
        ownerNodeId: trashNodeId,
        previousOwnerNodeId: ownerNodeId,
      };
      const placementChange: Mutation = {
        kind: "occurrence-move",
        occurrenceId,
        parentNodeId: trashNodeId,
        anchor: end,
        previousParentNodeId: placement.parentNodeId,
        previousAnchor: placement.anchor,
      };
      result.push(ownerChange, placementChange);
      owners.set(mutation.nodeId, trashNodeId);
      placements.set(occurrenceId, { ...placement, parentNodeId: trashNodeId, anchor: end });
    }
    return result;
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
    { kind: "node-create", nodeId: "node" },
    {
      kind: "node-owner-set",
      nodeId: "node",
      ownerNodeId: "workspace",
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    },
  ]);
  return fixture;
}
