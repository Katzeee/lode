import {
  parseEngineCommand as parseSdkEngineCommand,
  parseEngineQuery as parseSdkEngineQuery,
  type EngineCommand,
  type EngineQuery,
} from "@lode/sdk";
import { parseEditAction, type EditAction } from "../../../domain/edit/index.js";
import type { HistorySelection } from "../../../domain/history/index.js";
import type { ReviewSelection } from "../../../domain/review/index.js";
import { requireFactIds, type FactId } from "../../../domain/fact/index.js";
import { parseHistorySelectionContract, parseReviewSelectionContract } from "./selection-validation.js";

type AcceptedCommand<Kind extends EngineCommand["kind"], Fields extends object> = Omit<
  Extract<EngineCommand, { kind: Kind }>,
  keyof Fields
> &
  Readonly<Fields>;

export type AcceptedEditCommand = AcceptedCommand<"edit", { actions: readonly EditAction[] }>;
export type AcceptedReviewCommand = AcceptedCommand<"resolve-review", { selection: ReviewSelection }>;
export type AcceptedHistoryCommand = AcceptedCommand<"undo" | "redo", { selection: HistorySelection }>;
export type AcceptedAdjudicationCommand = AcceptedCommand<
  "adjudicate-resolution",
  { proposalFactIds: readonly FactId[]; resolutionIds: readonly FactId[] }
>;
export type AcceptedEngineCommand =
  | AcceptedEditCommand
  | AcceptedReviewCommand
  | AcceptedHistoryCommand
  | AcceptedAdjudicationCommand
  | Exclude<EngineCommand, { kind: "edit" | "resolve-review" | "undo" | "redo" | "adjudicate-resolution" }>;

export function parseEngineCommand(value: unknown): AcceptedEngineCommand {
  const command = parseSdkEngineCommand(value);
  switch (command.kind) {
    case "edit":
      return { ...command, actions: command.actions.map(parseEditAction) };
    case "resolve-review":
      return { ...command, selection: parseReviewSelectionContract(command.selection) };
    case "undo":
    case "redo":
      return { ...command, selection: parseHistorySelectionContract(command.selection) };
    case "adjudicate-resolution":
      return {
        ...command,
        proposalFactIds: requireFactIds(command.proposalFactIds, "Proposal targets"),
        resolutionIds: requireFactIds(command.resolutionIds, "Resolution identities"),
      };
    case "finalize-deletions":
      return command;
  }
}

export function parseEngineQuery(value: unknown): EngineQuery {
  return parseSdkEngineQuery(value);
}
