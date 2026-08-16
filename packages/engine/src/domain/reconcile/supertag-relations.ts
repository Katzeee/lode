import {
  compareFacts,
  FIELD_DEFINITION_NODE_TYPE,
  stableStringCompare,
  SUPERTAG_DEFINITION_NODE_TYPE,
  type ContributionFact,
} from "../fact/index.js";
import type { EffectiveField, MaterializedField, TemplateField } from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";
import { configuredFieldItems, fieldInitializations, projectEffectiveFields } from "./supertag-field-config.js";
import { observedRelations, supertagApplicationEvent, supertagExtensionEvent } from "./supertag-relation-events.js";
import { boundSupertagFields, boundSupertagTemplateNodes } from "./supertag-template-bindings.js";
import { activeNodeTypes } from "./node-type-declarations.js";
import { filterMaterializedFields, filterRecordOwners, filterTemplateFields } from "./node-type-filters.js";

export type SupertagRelations = Readonly<{
  supertagApplications: Readonly<Record<string, readonly string[]>>;
  supertagFields: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>;
  supertagExtensions: Readonly<Record<string, readonly string[]>>;
  supertagInstanceSupertags: Readonly<Record<string, readonly string[]>>;
  supertagExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
}>;

export function deriveSupertagRelations(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  initializedFields: Readonly<Record<string, readonly MaterializedField[]>> = {},
): SupertagRelations {
  const nodeTypes = activeNodeTypes(active);
  const supertagDefinitionIds = new Set(
    [...nodeTypes].flatMap(([nodeId, nodeType]) => (nodeType === SUPERTAG_DEFINITION_NODE_TYPE ? [nodeId] : [])),
  );
  const fieldDefinitionIds = new Set(
    [...nodeTypes].flatMap(([nodeId, nodeType]) => (nodeType === FIELD_DEFINITION_NODE_TYPE ? [nodeId] : [])),
  );
  const applications = observedRelations(active, supertagApplicationEvent, existingNodeIds, supertagDefinitionIds);
  const extensions = observedRelations(active, supertagExtensionEvent, supertagDefinitionIds, supertagDefinitionIds);
  const supertagApplications = record(applications);
  const boundFields = filterTemplateFields(
    boundSupertagFields(active, knownNodeIds, occurrences, childOccurrences),
    supertagDefinitionIds,
    fieldDefinitionIds,
    existingNodeIds,
  );
  const supertagTemplateNodes = filterRecordOwners(
    boundSupertagTemplateNodes(active, knownNodeIds, occurrences, childOccurrences),
    supertagDefinitionIds,
  );
  const templateFields = configuredFieldItems(active, boundFields);
  const supertagFields = Object.fromEntries(
    Object.entries(templateFields).map(([supertagId, fields]) => [
      supertagId,
      fields.map((field) => field.fieldDefinitionId),
    ]),
  );
  const supertagExtensions = record(extensions);
  const extensionGraph = supertagExtensionGraph(supertagExtensions);
  const materializedFields = mergeMaterializedFields(
    materialized(active, existingNodeIds, fieldDefinitionIds, occurrences, childOccurrences),
    filterMaterializedFields(initializedFields, fieldDefinitionIds),
  );
  const initializations = fieldInitializations(active);
  const activeApplications = filterRelationTargets(supertagApplications, existingNodeIds);
  const activeFieldItems = Object.fromEntries(
    Object.entries(templateFields)
      .filter(([supertagId]) => existingNodeIds.has(supertagId))
      .map(([supertagId, items]) => [supertagId, items.filter((item) => existingNodeIds.has(item.fieldDefinitionId))]),
  );
  const activeExtensions = Object.fromEntries(
    Object.entries(supertagExtensions)
      .filter(([supertagId]) => existingNodeIds.has(supertagId))
      .map(([supertagId, baseIds]) => [supertagId, baseIds.filter((baseId) => existingNodeIds.has(baseId))]),
  );
  return {
    supertagApplications,
    supertagFields,
    templateFields,
    supertagTemplateNodes,
    supertagExtensions,
    supertagInstanceSupertags: extensionGraph.instanceSupertags,
    supertagExtensionConflicts: extensionGraph.conflicts,
    effectiveFields: projectEffectiveFields(
      activeApplications,
      activeFieldItems,
      activeExtensions,
      materializedFields,
      initializations,
    ),
    materializedFields,
  };
}

function mergeMaterializedFields(
  explicit: Readonly<Record<string, readonly MaterializedField[]>>,
  initialized: Readonly<Record<string, readonly MaterializedField[]>>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  const ownerIds = new Set([...Object.keys(explicit), ...Object.keys(initialized)]);
  return Object.fromEntries(
    [...ownerIds].map((ownerNodeId) => [
      ownerNodeId,
      [...(explicit[ownerNodeId] ?? []), ...(initialized[ownerNodeId] ?? [])].filter(
        (field, index, fields) =>
          fields.findIndex((candidate) => candidate.fieldDefinitionId === field.fieldDefinitionId) === index,
      ),
    ]),
  );
}

function materialized(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  const candidates = new Map<string, MaterializationCandidate[]>();
  const claimedNodes = new Set<string>();
  const claimedOccurrences = new Set<string>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "field-materialize") {
      continue;
    }
    const ownerKey = `${encodeURIComponent(mutation.ownerNodeId)}/${encodeURIComponent(mutation.fieldDefinitionId)}`;
    const occurrence = occurrences.get(mutation.fieldOccurrenceId);
    if (
      !existingNodeIds.has(mutation.ownerNodeId) ||
      !existingNodeIds.has(mutation.fieldNodeId) ||
      !fieldDefinitionIds.has(mutation.fieldDefinitionId) ||
      occurrence?.nodeId !== mutation.fieldNodeId ||
      occurrence.parentNodeId !== mutation.ownerNodeId
    ) {
      continue;
    }
    const values = candidates.get(ownerKey) ?? [];
    values.push({ fact, ...mutation });
    candidates.set(ownerKey, values);
  }
  const byOwner = new Map<string, MaterializedField[]>();
  for (const ownerCandidates of [...candidates.values()].sort((left, right) =>
    compareCandidateGroups(left, right, occurrences, childOccurrences),
  )) {
    const available = ownerCandidates
      .sort((left, right) => compareFacts(left.fact, right.fact))
      .filter(
        (candidate) => !claimedNodes.has(candidate.fieldNodeId) && !claimedOccurrences.has(candidate.fieldOccurrenceId),
      );
    const canonical = available[0];
    if (!canonical) {
      continue;
    }
    const valueOccurrenceIds: string[] = [];
    for (const candidate of available) {
      claimedNodes.add(candidate.fieldNodeId);
      claimedOccurrences.add(candidate.fieldOccurrenceId);
      for (const occurrenceId of childOccurrences.get(candidate.fieldNodeId) ?? []) {
        appendUnique(valueOccurrenceIds, occurrenceId);
      }
    }
    const ownerFields = byOwner.get(canonical.ownerNodeId) ?? [];
    ownerFields.push({
      ownerNodeId: canonical.ownerNodeId,
      fieldDefinitionId: canonical.fieldDefinitionId,
      fieldNodeId: canonical.fieldNodeId,
      fieldOccurrenceId: canonical.fieldOccurrenceId,
      valueOccurrenceIds,
    });
    byOwner.set(canonical.ownerNodeId, ownerFields);
  }
  return recordFields(byOwner);
}

type MaterializationCandidate = Readonly<{
  fact: ContributionFact;
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
}>;

function compareCandidateGroups(
  left: readonly MaterializationCandidate[],
  right: readonly MaterializationCandidate[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): number {
  const leftCandidate = left[0];
  const rightCandidate = right[0];
  if (!leftCandidate || !rightCandidate) {
    return left.length - right.length;
  }
  const leftOccurrence = occurrences.get(leftCandidate.fieldOccurrenceId);
  const rightOccurrence = occurrences.get(rightCandidate.fieldOccurrenceId);
  const leftParent = leftOccurrence?.parentNodeId ?? null;
  const rightParent = rightOccurrence?.parentNodeId ?? null;
  const sharedParent = leftParent === rightParent ? leftParent : null;
  const placementOrder =
    sharedParent !== null
      ? (childOccurrences.get(sharedParent)?.indexOf(leftCandidate.fieldOccurrenceId) ?? -1) -
        (childOccurrences.get(sharedParent)?.indexOf(rightCandidate.fieldOccurrenceId) ?? -1)
      : 0;
  return (
    placementOrder ||
    stableStringCompare(leftCandidate.ownerNodeId, rightCandidate.ownerNodeId) ||
    stableStringCompare(leftCandidate.fieldDefinitionId, rightCandidate.fieldDefinitionId)
  );
}

function filterRelationTargets(
  relations: Readonly<Record<string, readonly string[]>>,
  ownerNodeIds: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(relations).map(([ownerId, targetIds]) => [
      ownerId,
      targetIds.filter((targetId) => ownerNodeIds.has(targetId)),
    ]),
  );
}

function recordFields(
  values: ReadonlyMap<string, readonly MaterializedField[]>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  return Object.fromEntries(
    [...values].filter(([, entries]) => entries.length > 0).sort(([left], [right]) => stableStringCompare(left, right)),
  );
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function record(values: ReadonlyMap<string, readonly string[]>): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...values].filter(([, entries]) => entries.length > 0).sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
