import {
  compareFacts,
  contributionFactsOfKind,
  stableStringCompare,
  type ContributionFact,
  type ContributionFactOf,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SharedDefaultViewDefinition } from "./projection-types.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectSharedDefaultViewDefinitions(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, readonly SharedDefaultViewDefinition[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const orderedFacts = [...active].sort(compareFacts);
  const modes = activeModeCandidates(orderedFacts);
  const candidates = new Map<string, Map<string, SharedDefaultViewDefinition>>();
  for (const fact of orderedFacts) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "shared-default-view-definition-attach") {
      continue;
    }
    const rootNodeId = metanodes[mutation.hostNodeId];
    const occurrence = occurrences.get(mutation.viewDefinitionOccurrenceId);
    const modeCandidates = modes.get(mutation.viewDefinitionNodeId) ?? [];
    const viewTypes = new Set(modeCandidates.map((candidate) => candidate.body.mutation.viewType));
    const viewType = viewTypes.size === 1 ? [...viewTypes][0] : undefined;
    if (
      rootNodeId === undefined ||
      viewType === undefined ||
      occurrence?.nodeId !== mutation.viewDefinitionNodeId ||
      occurrence.parentNodeId !== rootNodeId ||
      nodeLocation(workspaceNodeId, graph, mutation.hostNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.viewDefinitionNodeId) !== "active"
    ) {
      continue;
    }
    const byDefinition = candidates.get(mutation.hostNodeId) ?? new Map<string, SharedDefaultViewDefinition>();
    const definition: SharedDefaultViewDefinition = {
      hostNodeId: mutation.hostNodeId,
      viewDefinitionNodeId: mutation.viewDefinitionNodeId,
      viewDefinitionOccurrenceId: mutation.viewDefinitionOccurrenceId,
      viewType,
      modeContributionIds: modeCandidates.map((candidate) => candidate.id),
    };
    const previous = byDefinition.get(mutation.viewDefinitionNodeId);
    if (previous === undefined || definitionIdentity(previous) === definitionIdentity(definition)) {
      byDefinition.set(mutation.viewDefinitionNodeId, definition);
    } else {
      byDefinition.delete(mutation.viewDefinitionNodeId);
    }
    candidates.set(mutation.hostNodeId, byDefinition);
  }
  return Object.fromEntries(
    [...candidates]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([hostNodeId, byDefinition]) => [
        hostNodeId,
        [...byDefinition]
          .sort(([left], [right]) => stableStringCompare(left, right))
          .map(([, definition]) => definition),
      ]),
  );
}

function activeModeCandidates(
  facts: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFactOf<"shared-default-view-definition-mode-set">[]> {
  const modes = contributionFactsOfKind(facts, "shared-default-view-definition-mode-set");
  const superseded = new Set(modes.flatMap((fact) => fact.body.mutation.observedModeFactIds ?? []));
  const byDefinition = new Map<string, ContributionFactOf<"shared-default-view-definition-mode-set">[]>();
  for (const fact of modes) {
    if (superseded.has(fact.id)) {
      continue;
    }
    const definitionId = fact.body.mutation.viewDefinitionNodeId;
    const candidates = byDefinition.get(definitionId) ?? [];
    candidates.push(fact);
    byDefinition.set(definitionId, candidates);
  }
  return byDefinition;
}

function definitionIdentity(definition: SharedDefaultViewDefinition): string {
  return `${definition.viewDefinitionOccurrenceId}/${definition.viewType}/${definition.modeContributionIds.join(",")}`;
}
