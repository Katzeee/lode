import {
  compareFacts,
  canonicalJson,
  contributionFactsOfKind,
  stableStringCompare,
  type ContributionFact,
  type ContributionFactOf,
  NODE_VIEWS_DEFINITION_NODE_ID,
  VIEW_SORT_ASCENDING_NODE_ID,
  VIEW_SORT_FIELD_DEFINITION_NODE_ID,
  VIEW_SORT_NODE_NAME_NODE_ID,
  VIEW_SORT_ORDER_DEFINITION_NODE_ID,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { MaterializedField, SharedDefaultViewDefinition } from "./projection-types.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import { projectTuple } from "./tuple.js";

export function projectSharedDefaultViewDefinitions(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
): Readonly<Record<string, readonly SharedDefaultViewDefinition[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const orderedFacts = [...active].sort(compareFacts);
  const modes = activeModeCandidates(orderedFacts);
  const options = activeOptionsCandidates(orderedFacts);
  const candidates = new Map<string, Map<string, SharedDefaultViewDefinition>>();
  for (const fact of orderedFacts) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "shared-default-view-definition-attach") {
      continue;
    }
    const rootNodeId = metanodes[mutation.hostNodeId];
    const attachmentOccurrence = occurrences.get(mutation.attachmentOccurrenceId);
    const definitionOccurrence = occurrences.get(mutation.viewDefinitionOccurrenceId);
    const tuple = projectTuple(mutation.attachmentNodeId, occurrences, childOccurrences, nodeOwners);
    const relationDefinitionEndpoint = tuple.endpoints[0];
    const viewDefinitionEndpoint = tuple.endpoints[1];
    const modeCandidates = modes.get(mutation.viewDefinitionNodeId) ?? [];
    const optionCandidates = options.get(mutation.viewDefinitionNodeId) ?? [];
    const optionValues = [
      ...new Map(
        optionCandidates.map((candidate) => [
          canonicalJson(candidate.body.mutation.options),
          candidate.body.mutation.options,
        ]),
      ).values(),
    ];
    const selectedOptions = optionValues[0];
    const viewTypes = new Set(modeCandidates.map((candidate) => candidate.body.mutation.viewType));
    const viewType = viewTypes.size === 1 ? [...viewTypes][0] : undefined;
    if (
      rootNodeId === undefined ||
      viewType === undefined ||
      attachmentOccurrence?.nodeId !== mutation.attachmentNodeId ||
      attachmentOccurrence.parentNodeId !== rootNodeId ||
      tuple.ownerNodeId !== rootNodeId ||
      definitionOccurrence?.nodeId !== mutation.viewDefinitionNodeId ||
      definitionOccurrence.parentNodeId !== mutation.attachmentNodeId ||
      relationDefinitionEndpoint?.occurrenceId !== mutation.relationDefinitionOccurrenceId ||
      relationDefinitionEndpoint.nodeId !== NODE_VIEWS_DEFINITION_NODE_ID ||
      viewDefinitionEndpoint?.occurrenceId !== mutation.viewDefinitionOccurrenceId ||
      viewDefinitionEndpoint.nodeId !== mutation.viewDefinitionNodeId ||
      nodeOwners[relationDefinitionEndpoint.nodeId] === mutation.attachmentNodeId ||
      nodeOwners[mutation.viewDefinitionNodeId] !== mutation.attachmentNodeId ||
      tuple.endpoints.length !== 2 ||
      nodeLocation(workspaceNodeId, graph, mutation.hostNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.viewDefinitionNodeId) !== "active"
    ) {
      continue;
    }
    const byDefinition = candidates.get(mutation.hostNodeId) ?? new Map<string, SharedDefaultViewDefinition>();
    const definition: SharedDefaultViewDefinition = {
      hostNodeId: mutation.hostNodeId,
      attachmentNodeId: mutation.attachmentNodeId,
      attachmentOccurrenceId: mutation.attachmentOccurrenceId,
      relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
      viewDefinitionNodeId: mutation.viewDefinitionNodeId,
      viewDefinitionOccurrenceId: mutation.viewDefinitionOccurrenceId,
      viewType,
      modeContributionIds: modeCandidates.map((candidate) => candidate.id),
      options: optionValues.length === 1 && selectedOptions !== undefined ? selectedOptions : emptyViewOptions(),
      optionsContributionIds: optionCandidates.map((candidate) => candidate.id),
      optionsConflicted: optionValues.length > 1,
      sortByNameAscending: projectSortByNameAscending(
        mutation.viewDefinitionNodeId,
        materializedFields,
        occurrences,
        childOccurrences,
      ),
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

function activeOptionsCandidates(
  facts: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFactOf<"shared-default-view-definition-options-set">[]> {
  const options = contributionFactsOfKind(facts, "shared-default-view-definition-options-set");
  const superseded = new Set(options.flatMap((fact) => fact.body.mutation.observedOptionsFactIds ?? []));
  const byDefinition = new Map<string, ContributionFactOf<"shared-default-view-definition-options-set">[]>();
  for (const fact of options) {
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

function emptyViewOptions(): SharedDefaultViewDefinition["options"] {
  return { columns: [], filter: null, sort: null, group: null };
}

function definitionIdentity(definition: SharedDefaultViewDefinition): string {
  return `${definition.attachmentNodeId}/${definition.attachmentOccurrenceId}/${definition.viewDefinitionOccurrenceId}/${definition.viewType}/${definition.modeContributionIds.join(",")}/${canonicalJson(definition.options)}/${definition.optionsContributionIds.join(",")}/${definition.optionsConflicted}/${JSON.stringify(definition.sortByNameAscending)}`;
}

function projectSortByNameAscending(
  viewDefinitionNodeId: string,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): SharedDefaultViewDefinition["sortByNameAscending"] {
  const outer = uniqueField(materializedFields[viewDefinitionNodeId], VIEW_SORT_ORDER_DEFINITION_NODE_ID);
  if (outer === undefined) {
    return null;
  }
  const inner = uniqueField(materializedFields[outer.fieldNodeId], VIEW_SORT_FIELD_DEFINITION_NODE_ID);
  const endpoints = inner === undefined ? [] : (childOccurrences.get(inner.fieldNodeId) ?? []);
  const nodeNameOccurrenceId = endpoints[1];
  const ascendingOccurrenceId = endpoints[2];
  if (
    inner === undefined ||
    outer.valueOccurrenceIds.length !== 1 ||
    outer.valueOccurrenceIds[0] !== inner.fieldOccurrenceId ||
    nodeNameOccurrenceId === undefined ||
    ascendingOccurrenceId === undefined ||
    endpoints.length !== 3 ||
    occurrences.get(nodeNameOccurrenceId)?.nodeId !== VIEW_SORT_NODE_NAME_NODE_ID ||
    occurrences.get(ascendingOccurrenceId)?.nodeId !== VIEW_SORT_ASCENDING_NODE_ID
  ) {
    return null;
  }
  return {
    sortOrderFieldNodeId: outer.fieldNodeId,
    sortOrderFieldOccurrenceId: outer.fieldOccurrenceId,
    sortFieldNodeId: inner.fieldNodeId,
    sortFieldOccurrenceId: inner.fieldOccurrenceId,
    nodeNameOccurrenceId,
    ascendingOccurrenceId,
  };
}

function uniqueField(
  fields: readonly MaterializedField[] | undefined,
  fieldDefinitionId: string,
): MaterializedField | undefined {
  const matches = fields?.filter((field) => field.fieldDefinitionId === fieldDefinitionId) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}
