import {
  parseEngineCommand as parseSdkEngineCommand,
  parseEngineQuery as parseSdkEngineQuery,
  type EngineCommand,
  type EngineQuery,
} from "@lode/sdk";
import { parseEditAction, type EditAction } from "../../../domain/edit/index.js";
import type { HistorySelection } from "../../../domain/history/index.js";
import type { ReviewSelection } from "../../../domain/review/index.js";
import type { HardDeleteSelection } from "../../../domain/maintenance/index.js";
import { requireFactActionIds, requireFactIds, type FactId } from "../../../domain/fact/index.js";
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
type AcceptedDeletionAcknowledgementCommand = AcceptedCommand<
  "acknowledge-deletion",
  { deletionActionIds: HardDeleteSelection["deletionActionIds"] }
>;
type AcceptedHardDeleteCommand = AcceptedCommand<"hard-delete", { selection: HardDeleteSelection }>;
export type AcceptedEngineCommand =
  | AcceptedEditCommand
  | AcceptedReviewCommand
  | AcceptedHistoryCommand
  | AcceptedAdjudicationCommand
  | AcceptedDeletionAcknowledgementCommand
  | AcceptedHardDeleteCommand
  | Exclude<
      EngineCommand,
      {
        kind:
          | "edit"
          | "resolve-review"
          | "undo"
          | "redo"
          | "adjudicate-resolution"
          | "acknowledge-deletion"
          | "hard-delete";
      }
    >;

export function parseEngineCommand(value: unknown): AcceptedEngineCommand {
  const command = parseSdkEngineCommand(value);
  switch (command.kind) {
    case "edit":
      return { ...command, actions: command.actions.map(parseEditAction) };
    case "resolve-review":
      return { ...command, selection: parseReviewSelectionContract(command.selection) };
    case "undo":
    case "redo":
      return { ...command, selection: parseHistorySelectionContract(command.selection, command.kind) };
    case "adjudicate-resolution":
      return {
        ...command,
        proposalFactIds: requireFactIds(command.proposalFactIds, "Proposal targets"),
        resolutionIds: requireFactIds(command.resolutionIds, "Resolution identities"),
      };
    case "acknowledge-deletion":
      return {
        ...command,
        deletionActionIds: requireFactActionIds(command.deletionActionIds, "Deletion actions"),
      };
    case "retire-replica":
      return command;
    case "hard-delete":
      return {
        ...command,
        selection: {
          ...command.selection,
          deletionActionIds: requireFactActionIds(command.selection.deletionActionIds, "Deletion actions"),
          acknowledgementFactIds: requireFactIds(command.selection.acknowledgementFactIds, "Acknowledgement Facts"),
        },
      };
  }
}

export function parseEngineQuery(value: unknown): EngineQuery {
  const query = parseSdkEngineQuery(value);
  switch (query.kind) {
    case "projection":
      return {
        ...query,
        section: query.section ?? "nodes",
        after: query.after ?? null,
        limit: query.limit ?? 100,
      };
    case "review":
    case "conflicts":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "supertag-instances":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "backlinks":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "search-results":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "view-rows":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "outline":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "debug-node":
      return query;
    case "history":
    case "invocation":
    case "hard-delete-preview":
    case "trash-evidence":
      return query;
  }
}
