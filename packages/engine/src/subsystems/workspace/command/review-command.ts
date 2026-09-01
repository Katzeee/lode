import { resolutionAdjudicationProblem } from "../../../domain/conflict/index.js";
import { validateReviewSelection } from "../../../domain/review/index.js";
import type { AcceptedAdjudicationCommand, AcceptedReviewCommand } from "../application/input-validation.js";
import { rejectedResult } from "../application/result-mapping.js";
import type { BoundWorkspaceCommand, WorkspaceCommandPlanningContext } from "./command-rule.js";

export function bindReviewCommand(command: AcceptedReviewCommand | AcceptedAdjudicationCommand): BoundWorkspaceCommand {
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
