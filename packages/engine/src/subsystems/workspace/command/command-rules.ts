import type {
  AcceptedEngineCommand,
  AcceptedAdjudicationCommand,
  AcceptedHistoryCommand,
  AcceptedEditCommand,
  AcceptedReviewCommand,
} from "../application/input-validation.js";
import type { ActorId, EditIntent, FactBody } from "../../../domain/fact/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../../domain/history/index.js";
import { validateReviewSelection } from "../../../domain/review/index.js";
import { resolutionAdjudicationProblem } from "../../../domain/conflict/index.js";
import { prepareEdits, prepareReceiptInverse, type AuthoredActionBatch } from "../edit-planning/index.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand, WorkspaceCommandPlanningContext } from "./command-rule.js";
import { bindMaintenanceCommand } from "./maintenance.js";

export function bindWorkspaceCommand(command: AcceptedEngineCommand): BoundWorkspaceCommand {
  switch (command.kind) {
    case "edit":
      return bindEditCommand(command);
    case "resolve-review":
    case "adjudicate-resolution":
      return bindReviewCommand(command);
    case "undo":
    case "redo":
      return bindHistoryCommand(command);
    case "acknowledge-deletion":
    case "retire-replica":
    case "hard-delete":
      return bindMaintenanceCommand(command);
    default:
      return assertNever(command);
  }
}

function bindEditCommand(command: AcceptedEditCommand): BoundWorkspaceCommand {
  return {
    readPlan: {
      kind: "edits",
      actions: command.actions,
      historyChannelId: command.historyChannelId,
    },
    plan({ workspaceId, snapshot, generation, receipts, maintenanceAuthority }) {
      const prepared = prepareEdits(
        workspaceId,
        command.actorId,
        command.actions,
        generation,
        command.intent,
        snapshot,
        maintenanceAuthority.replicaId,
      );
      return {
        writes: prepared.writes.map((write) => editFactBody(write, command.actorId, command.intent)),
        lineage: nextHistoryLineage(receipts, command.historyChannelId, "normal", null),
        inverse: prepared.inverse,
      };
    },
  };
}

function bindReviewCommand(command: AcceptedReviewCommand | AcceptedAdjudicationCommand): BoundWorkspaceCommand {
  return {
    readPlan:
      command.kind === "resolve-review"
        ? { kind: "action-ids", actionIds: command.selection.evidence.supportClosure, historyChannelId: null }
        : {
            kind: "facts",
            factIds: [...command.proposalFactIds, ...command.resolutionIds],
            historyChannelId: null,
          },
    plan(context) {
      return command.kind === "resolve-review"
        ? planReviewResolution(command, context)
        : planResolutionAdjudication(command, context);
    },
  };
}

function planReviewResolution(
  command: AcceptedReviewCommand,
  { workspaceId, snapshot, generation, reviewCapabilityKey }: WorkspaceCommandPlanningContext,
) {
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
    ? { writes: [validation.resolution], lineage: null, inverse: [] }
    : rejectedResult("stale-selection", validation.reason, generation.identity.generationId);
}

function planResolutionAdjudication(
  command: AcceptedAdjudicationCommand,
  { snapshot, generation }: WorkspaceCommandPlanningContext,
) {
  const problem = resolutionAdjudicationProblem(snapshot, command.proposalFactIds, command.resolutionIds);
  return problem
    ? rejectedResult("stale-selection", problem, generation.identity.generationId)
    : {
        writes: [
          {
            kind: "resolution" as const,
            actorId: command.actorId,
            decision: command.decision,
            proposalFactIds: command.proposalFactIds,
            adjudicatesResolutionIds: command.resolutionIds,
          },
        ],
        lineage: null,
        inverse: [],
      };
}

function bindHistoryCommand(command: AcceptedHistoryCommand): BoundWorkspaceCommand {
  const selection = command.selection;
  return {
    readPlan: {
      kind: "facts",
      factIds: selection.targetFactIds,
      historyChannelId: selection.channelId,
    },
    plan({ workspaceId, snapshot, generation, receipts, maintenanceAuthority }) {
      const validation = validateHistorySelection(selection, receipts, snapshot, generation);
      if (validation.kind !== "ready") {
        return rejectedResult(
          validation.kind === "stale" ? "stale-selection" : "history-unavailable",
          validation.reason,
          generation.identity.generationId,
        );
      }
      const inverse = prepareReceiptInverse(
        workspaceId,
        command.actorId,
        validation.writes,
        generation,
        snapshot,
        maintenanceAuthority.replicaId,
      );
      return {
        writes: validation.writes.map((batch) => ({
          kind: "edit" as const,
          actorId: command.actorId,
          intent: batch.intent,
          actions: batch.actions,
        })),
        lineage: nextHistoryLineage(receipts, selection.channelId, command.kind, validation.targetInvocationId),
        inverse,
      };
    },
  };
}

function editFactBody(write: AuthoredActionBatch, actorId: ActorId, intent: EditIntent): FactBody {
  const [first, ...rest] = write;
  return { kind: "edit", actorId, intent, actions: [first, ...rest] };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Workspace command: ${JSON.stringify(value)}`);
}
