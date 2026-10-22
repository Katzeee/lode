import { requireFactActionIds } from "../../../domain/fact/index.js";
import type { HistorySelection } from "../../../domain/history/index.js";
import type { ReviewSelection } from "../../../domain/review/index.js";
import { exact, nonempty, object } from "../../../decoding/index.js";

export function parseReviewSelectionContract(value: unknown): ReviewSelection {
  const selection = object(value, "Review selection");
  exact(selection, ["evidenceId", "proposalActionIds"], "Review selection");
  return {
    evidenceId: nonempty(selection.evidenceId, "Review evidence id"),
    proposalActionIds: requireFactActionIds(selection.proposalActionIds, "Proposal action ids"),
  };
}

export function parseHistorySelectionContract(value: unknown): HistorySelection {
  const selection = object(value, "History selection");
  exact(selection, ["token", "channelId"], "History selection");
  return {
    token: nonempty(selection.token, "History token"),
    channelId: nonempty(selection.channelId, "History channel"),
  };
}
