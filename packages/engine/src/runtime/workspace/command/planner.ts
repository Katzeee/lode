import type { EngineCommand, RejectedResult } from "../../../application/contract.js";
import type {
  ActorId,
  AuthorityReceipt,
  EditIntent,
  FactSnapshot,
  FactWrite,
} from "../../../domain/fact/index.js";
import type { MutationWrite } from "../../../domain/edit/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../../domain/history/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import { validateReviewSelection } from "../../../domain/review/index.js";
import { resolutionAdjudicationProblem } from "../../../domain/conflict/index.js";
import { prepareEdits } from "../mutation-planning/index.js";
import { rejectedResult } from "../workspace-results.js";
import { isMaintenanceCommand, planMaintenanceCommand } from "./maintenance.js";

type WorkspaceCommandPlan =
  | Readonly<{
      writes: readonly FactWrite[];
      lineage: AuthorityReceipt["lineage"];
    }>
  | RejectedResult;

type WorkspaceCommandPlanningContext = Readonly<{
  workspaceId: string;
  snapshot: FactSnapshot;
  generation: ScopedProjectionGeneration;
  receipts: readonly AuthorityReceipt[];
  maintenanceAuthority: Parameters<typeof planMaintenanceCommand>[4];
  reviewCapabilityKey?: string;
}>;

export function planWorkspaceCommand(
  command: EngineCommand,
  context: WorkspaceCommandPlanningContext,
): WorkspaceCommandPlan {
  const { workspaceId, snapshot, generation, receipts, maintenanceAuthority, reviewCapabilityKey } =
    context;
  if (isMaintenanceCommand(command)) {
    return planMaintenanceCommand(workspaceId, command, snapshot, generation, maintenanceAuthority);
  }
  if (command.kind === "mutate") {
    const writes = prepareEdits(
      workspaceId,
      command.actorId,
      command.mutations,
      generation,
      command.intent,
      snapshot,
    );
    return {
      writes: writes.map((write) => contributionWrite(write, command.actorId, command.intent)),
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
      ? { writes: [validation.resolution], lineage: null }
      : rejectedResult("stale-selection", validation.reason, generation.identity.generationId);
  }
  if (command.kind === "adjudicate-resolution") {
    const problem = resolutionAdjudicationProblem(
      snapshot,
      command.proposalContributionIds,
      command.resolutionIds,
    );
    return problem
      ? rejectedResult("stale-selection", problem, generation.identity.generationId)
      : {
          writes: [
            {
              kind: "resolution",
              actorId: command.actorId,
              decision: command.decision,
              proposalContributionIds: command.proposalContributionIds,
              adjudicatesResolutionIds: command.resolutionIds,
            },
          ],
          lineage: null,
        };
  }
  const validation = validateHistorySelection(
    command.selection,
    command.actorId,
    receipts,
    snapshot,
    generation,
  );
  if (validation.kind !== "ready") {
    return rejectedResult(
      validation.kind === "stale" ? "stale-selection" : "history-unavailable",
      validation.reason,
      generation.identity.generationId,
    );
  }
  return {
    writes: [validation.write],
    lineage: nextHistoryLineage(
      receipts,
      command.selection.channelId,
      command.kind,
      validation.targetInvocationId,
    ),
  };
}

function contributionWrite(write: MutationWrite, actorId: ActorId, intent: EditIntent): FactWrite {
  if (write.kind === "single") {
    return { kind: "contribution", actorId, intent, mutation: write.mutation };
  }
  const [first, ...rest] = write.mutations;
  const body = (mutation: typeof first) =>
    ({ kind: "contribution", actorId, intent, mutation }) as const;
  return { kind: "transaction", bodies: [body(first), ...rest.map(body)] };
}
