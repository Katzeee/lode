import type {
  AcceptedEngineCommand,
  AcceptedHistoryCommand,
  AcceptedMutationCommand,
  AcceptedReviewCommand,
} from "../../../application/input-validation.js";
import type { AdjudicateResolutionCommand } from "@lode/sdk";
import type { ActorId, EditIntent, FactWrite } from "../../../domain/fact/index.js";
import type { MutationWrite } from "../../../domain/edit/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../../domain/history/index.js";
import { validateReviewSelection } from "../../../domain/review/index.js";
import { resolutionAdjudicationProblem } from "../../../domain/conflict/index.js";
import { prepareEdits } from "../mutation-planning/index.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand, WorkspaceCommandPlanningContext } from "./command-rule.js";
import { bindMaintenanceCommand } from "./maintenance.js";

export function bindWorkspaceCommand(command: AcceptedEngineCommand): BoundWorkspaceCommand {
  switch (command.kind) {
    case "mutate":
      return bindMutationCommand(command);
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

function bindMutationCommand(command: AcceptedMutationCommand): BoundWorkspaceCommand {
  return {
    readPlan: {
      kind: "mutations",
      mutations: command.mutations,
      historyChannelId: command.historyChannelId,
    },
    plan({ workspaceId, snapshot, generation, receipts }) {
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
    },
  };
}

function bindReviewCommand(command: AcceptedReviewCommand | AdjudicateResolutionCommand): BoundWorkspaceCommand {
  return {
    readPlan: {
      kind: "facts",
      factIds:
        command.kind === "resolve-review"
          ? command.selection.evidence.supportClosure
          : [...command.proposalContributionIds, ...command.resolutionIds],
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
    ? { writes: [validation.resolution], lineage: null }
    : rejectedResult("stale-selection", validation.reason, generation.identity.generationId);
}

function planResolutionAdjudication(
  command: AdjudicateResolutionCommand,
  { snapshot, generation }: WorkspaceCommandPlanningContext,
) {
  const problem = resolutionAdjudicationProblem(snapshot, command.proposalContributionIds, command.resolutionIds);
  return problem
    ? rejectedResult("stale-selection", problem, generation.identity.generationId)
    : {
        writes: [
          {
            kind: "resolution" as const,
            actorId: command.actorId,
            decision: command.decision,
            proposalContributionIds: command.proposalContributionIds,
            adjudicatesResolutionIds: command.resolutionIds,
          },
        ],
        lineage: null,
      };
}

function bindHistoryCommand(command: AcceptedHistoryCommand): BoundWorkspaceCommand {
  const selection = command.selection;
  return {
    readPlan: {
      kind: "facts",
      factIds: selection.evidence.targetFactIds,
      historyChannelId: selection.channelId,
    },
    plan({ snapshot, generation, receipts }) {
      const validation = validateHistorySelection(selection, command.actorId, receipts, snapshot, generation);
      if (validation.kind !== "ready") {
        return rejectedResult(
          validation.kind === "stale" ? "stale-selection" : "history-unavailable",
          validation.reason,
          generation.identity.generationId,
        );
      }
      return {
        writes: [validation.write],
        lineage: nextHistoryLineage(receipts, selection.channelId, command.kind, validation.targetInvocationId),
      };
    },
  };
}

function contributionWrite(write: MutationWrite, actorId: ActorId, intent: EditIntent): FactWrite {
  if (write.kind === "single") {
    return { kind: "contribution", actorId, intent, mutation: write.mutation };
  }
  const [first, ...rest] = write.mutations;
  const body = (mutation: typeof first) => ({ kind: "contribution", actorId, intent, mutation }) as const;
  return { kind: "transaction", bodies: [body(first), ...rest.map(body)] };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Workspace command: ${JSON.stringify(value)}`);
}
