import type { EngineCommand, RejectedResult } from "../../application/contract.js";
import type { AuthorityReceipt, FactBody, FactSnapshot } from "../../domain/fact/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../domain/history/index.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import { validateReviewSelection } from "../../domain/review/index.js";
import { prepareMutations } from "./mutation-planner.js";
import { rejectedResult } from "./workspace-results.js";

export type WorkspaceCommandPlan =
  Readonly<{ bodies: readonly FactBody[]; lineage: AuthorityReceipt["lineage"] }> | RejectedResult;

export function planWorkspaceCommand(
  workspaceId: string,
  command: EngineCommand,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  receipts: readonly AuthorityReceipt[],
  reviewCapabilityKey?: string,
  historyPlanningObserver?: HistoryPlanningObserver,
): WorkspaceCommandPlan {
  if (command.kind === "mutate") {
    const mutations = prepareMutations(
      workspaceId,
      command.mutations,
      generation,
      command.intent,
      snapshot,
    );
    return {
      bodies: mutations.map((mutation) => ({
        kind: "contribution",
        actorId: command.actorId,
        intent: command.intent,
        mutation,
      })),
      lineage: nextHistoryLineage(receipts, command.historyChannelId, "normal", null),
    };
  }
  if (command.kind === "resolve-review") {
    const validation = validateReviewSelection(
      workspaceId,
      command.selection,
      command.decision,
      command.actorId,
      snapshot,
      generation,
      reviewCapabilityKey,
    );
    return validation.kind === "valid"
      ? { bodies: [validation.resolution], lineage: null }
      : rejectedResult("stale-selection", validation.reason, generation.identity.generationId);
  }
  const validation = validateHistorySelection(
    command.selection,
    command.actorId,
    receipts,
    snapshot,
    generation,
    historyPlanningObserver,
  );
  if (validation.kind !== "ready") {
    return rejectedResult(
      validation.kind === "stale" ? "stale-selection" : "history-unavailable",
      validation.reason,
      generation.identity.generationId,
    );
  }
  return {
    bodies: validation.bodies,
    lineage: nextHistoryLineage(
      receipts,
      command.selection.channelId,
      command.kind,
      validation.targetInvocationId,
    ),
  };
}
