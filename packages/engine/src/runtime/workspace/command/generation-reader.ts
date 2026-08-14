import type { EngineCommand } from "../../../application/contract.js";
import type { EditMutation } from "../../../domain/edit/index.js";
import type { FactSnapshot, HistoryChannelId } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";
import { readEditGeneration } from "../generation-reading/index.js";

export type WorkspaceCommandReadPlan =
  | Readonly<{
      kind: "mutations";
      mutations: readonly EditMutation[];
      historyChannelId: HistoryChannelId | null;
    }>
  | Readonly<{
      kind: "facts";
      factIds: readonly string[];
      historyChannelId: HistoryChannelId | null;
    }>;

export function workspaceCommandReadPlan(command: EngineCommand): WorkspaceCommandReadPlan {
  switch (command.kind) {
    case "mutate":
      return {
        kind: "mutations",
        mutations: command.mutations,
        historyChannelId: command.historyChannelId,
      };
    case "resolve-review":
      return {
        kind: "facts",
        factIds: command.selection.evidence.supportClosure,
        historyChannelId: null,
      };
    case "adjudicate-resolution":
      return {
        kind: "facts",
        factIds: [...command.proposalContributionIds, ...command.resolutionIds],
        historyChannelId: null,
      };
    case "undo":
    case "redo":
      return {
        kind: "facts",
        factIds: command.selection.evidence.targetFactIds,
        historyChannelId: command.selection.channelId,
      };
    case "acknowledge-deletion":
    case "retire-replica":
    case "hard-delete":
      return { kind: "mutations", mutations: [], historyChannelId: null };
  }
}

export function readCommandGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
  plan: WorkspaceCommandReadPlan,
): Promise<ScopedProjectionGeneration> {
  return plan.kind === "mutations"
    ? readEditGeneration(store, generationId, plan.mutations)
    : readFactGeneration(store, generationId, snapshot, plan.factIds);
}
