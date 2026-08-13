import type { EngineCommand } from "../../application/contract.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import { readFactGeneration, readMutationGeneration } from "./mutation-generation-reader.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";

export function readCommandGeneration(
  store: ProjectionGenerationStore,
  generationId: string,
  snapshot: FactSnapshot,
  command: EngineCommand,
): Promise<ProjectionGeneration> {
  if (command.kind === "mutate") {
    return readMutationGeneration(store, generationId, command.mutations);
  }
  if (
    command.kind === "acknowledge-deletion" ||
    command.kind === "retire-replica" ||
    command.kind === "hard-delete"
  ) {
    return readMutationGeneration(store, generationId, []);
  }
  const factIds =
    command.kind === "resolve-review"
      ? command.selection.evidence.supportClosure
      : command.kind === "adjudicate-resolution"
        ? [...command.proposalContributionIds, ...command.resolutionIds]
        : command.selection.evidence.targetFactIds;
  return readFactGeneration(store, generationId, snapshot, factIds);
}
