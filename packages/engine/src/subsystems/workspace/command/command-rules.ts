import type {
  AcceptedEngineCommand,
  AcceptedAdjudicationCommand,
  AcceptedHistoryCommand,
  AcceptedEditCommand,
  AcceptedReviewCommand,
} from "../application/input-validation.js";
import { graphActionBody, type ActorId, type EditIntent, type FactBody } from "../../../domain/fact/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../../domain/history/index.js";
import { validateReviewSelection } from "../../../domain/review/index.js";
import { resolutionAdjudicationProblem } from "../../../domain/conflict/index.js";
import { prepareEdits, type AuthoredActionBatch } from "../edit-planning/index.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand, WorkspaceCommandPlanningContext } from "./command-rule.js";
import { bindDeletionFinalizationCommand } from "./deletion-finalization.js";

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
    case "finalize-deletions":
      return bindDeletionFinalizationCommand(command);
    default:
      return assertNever(command);
  }
}

function bindEditCommand(command: AcceptedEditCommand): BoundWorkspaceCommand {
  return {
    factReadPlan: {
      kind: "all",
    },
    plan({ workspaceId, snapshot, generation, replicaId }) {
      const writes = prepareEdits(
        workspaceId,
        command.actorId,
        command.actions,
        generation,
        command.intent,
        snapshot,
        replicaId,
      );
      return {
        writes: writes.map((write) => actionFactBody(write, command.actorId, command.intent)),
        lineage: nextHistoryLineage(snapshot, command.historyChannelId, "normal", null),
      };
    },
  };
}

function bindReviewCommand(command: AcceptedReviewCommand | AcceptedAdjudicationCommand): BoundWorkspaceCommand {
  return {
    factReadPlan:
      command.kind === "resolve-review"
        ? { kind: "action-ids", actionIds: command.selection.proposalActionIds }
        : {
            kind: "facts",
            factIds: [...command.proposalFactIds, ...command.resolutionIds],
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
  { snapshot, generation }: WorkspaceCommandPlanningContext,
) {
  const validation = validateReviewSelection(
    command.selection,
    command.decision,
    command.actorId,
    snapshot,
    generation,
  );
  return validation.kind === "valid"
    ? { writes: [validation.resolution], lineage: null }
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
      };
}

function bindHistoryCommand(command: AcceptedHistoryCommand): BoundWorkspaceCommand {
  const selection = command.selection;
  return {
    factReadPlan: {
      kind: "all",
    },
    plan({ snapshot, generation }) {
      const validation = validateHistorySelection(command.kind, selection, snapshot, generation);
      if (validation.kind !== "ready") {
        return rejectedResult(
          validation.kind === "stale" ? "stale-selection" : "history-unavailable",
          validation.reason,
          generation.identity.generationId,
        );
      }
      return {
        writes: validation.writes.map((batch) => graphActionBody(command.actorId, batch.intent, batch.actions)),
        lineage: nextHistoryLineage(snapshot, selection.channelId, command.kind, validation.targetStepId),
      };
    },
  };
}

function actionFactBody(write: AuthoredActionBatch, actorId: ActorId, intent: EditIntent): FactBody {
  return graphActionBody(actorId, intent, write);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Workspace command: ${JSON.stringify(value)}`);
}
