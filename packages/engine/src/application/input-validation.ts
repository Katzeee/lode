import {
  parseEngineCommand as parseSdkEngineCommand,
  parseEngineQuery as parseSdkEngineQuery,
  type EngineCommand,
  type EngineQuery,
} from "@lode/sdk";
import { parseEditMutation, type EditMutation } from "../domain/edit/index.js";
import type { HistorySelection } from "../domain/history/index.js";
import type { ReviewSelection } from "../domain/review/index.js";
import { parseHistorySelectionContract, parseReviewSelectionContract } from "./selection-validation.js";

type AcceptedCommand<Kind extends EngineCommand["kind"], Fields extends object> = Omit<
  Extract<EngineCommand, { kind: Kind }>,
  keyof Fields
> &
  Readonly<Fields>;

export type AcceptedMutationCommand = AcceptedCommand<"mutate", { mutations: readonly EditMutation[] }>;
export type AcceptedReviewCommand = AcceptedCommand<"resolve-review", { selection: ReviewSelection }>;
export type AcceptedHistoryCommand = AcceptedCommand<"undo" | "redo", { selection: HistorySelection }>;
export type AcceptedEngineCommand =
  | AcceptedMutationCommand
  | AcceptedReviewCommand
  | AcceptedHistoryCommand
  | Exclude<EngineCommand, { kind: "mutate" | "resolve-review" | "undo" | "redo" }>;

export function parseEngineCommand(value: unknown): AcceptedEngineCommand {
  const command = parseSdkEngineCommand(value);
  switch (command.kind) {
    case "mutate":
      return { ...command, mutations: command.mutations.map(parseEditMutation) };
    case "resolve-review":
      return { ...command, selection: parseReviewSelectionContract(command.selection) };
    case "undo":
    case "redo":
      return { ...command, selection: parseHistorySelectionContract(command.selection, command.kind) };
    case "adjudicate-resolution":
    case "acknowledge-deletion":
    case "retire-replica":
    case "hard-delete":
      return command;
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
    case "schema-search":
    case "view":
      return { ...query, after: query.after ?? null, limit: query.limit ?? 50 };
    case "history":
    case "invocation":
    case "hard-delete-preview":
      return query;
  }
}
