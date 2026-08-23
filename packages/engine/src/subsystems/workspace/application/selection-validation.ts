import { parseFactFrontier as frontier, requireFactActionIds, requireFactIds } from "../../../domain/fact/index.js";
import type { HistorySelection } from "../../../domain/history/index.js";
import type { ReviewSelection } from "../../../domain/review/index.js";
import { parseDecisionEffect } from "./decision-effect-validation.js";
import {
  array,
  enumValue as oneOf,
  exact,
  nonempty,
  nullableString,
  object,
  safeInteger,
  stringArray as strings,
} from "../../../decoding/index.js";

export function parseReviewSelectionContract(value: unknown): ReviewSelection {
  const selection = object(value, "Review selection");
  exact(selection, ["token", "workspaceId", "frontier", "generationId", "evidence"], "Review selection");
  const evidence = object(selection.evidence, "Decision evidence");
  exact(
    evidence,
    ["proposalTargets", "supportClosure", "effects", "associatedImpactIds", "rulesVersion", "schemaVersion"],
    "Decision evidence",
  );
  const parsed = {
    token: nonempty(selection.token, "selection token"),
    workspaceId: nonempty(selection.workspaceId, "selection Workspace"),
    frontier: frontier(selection.frontier),
    generationId: nonempty(selection.generationId, "selection generation"),
    evidence: {
      proposalTargets: requireFactActionIds(evidence.proposalTargets, "Proposal targets"),
      supportClosure: requireFactActionIds(evidence.supportClosure, "Support closure"),
      effects: array(evidence.effects, "Decision effects", parseDecisionEffect),
      associatedImpactIds: strings(evidence.associatedImpactIds, "associated impacts"),
      rulesVersion: nonempty(evidence.rulesVersion, "rules version"),
      schemaVersion: nonempty(evidence.schemaVersion, "schema version"),
    },
  };
  return parsed;
}

export function parseHistorySelectionContract(value: unknown, expectedOperation?: "undo" | "redo"): HistorySelection {
  const selection = object(value, "History selection");
  exact(
    selection,
    ["token", "channelId", "operation", "targetInvocationId", "headInvocationId", "headOrdinal", "targetFactIds"],
    "History selection",
  );
  const operation = oneOf(selection.operation, ["undo", "redo"] as const, "History operation");
  if (expectedOperation && operation !== expectedOperation) {
    throw new Error("History selection operation does not match command");
  }
  const targetInvocationId = nonempty(selection.targetInvocationId, "History target Invocation");
  const parsed = {
    token: nonempty(selection.token, "History token"),
    channelId: nonempty(selection.channelId, "History channel"),
    operation,
    targetInvocationId,
    headInvocationId: nullableString(selection.headInvocationId, "History head"),
    headOrdinal: safeInteger(selection.headOrdinal, 0, "History head ordinal"),
    targetFactIds: requireFactIds(selection.targetFactIds, "History target Facts"),
  };
  return parsed;
}
