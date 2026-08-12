import {
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type SequenceAnchor,
} from "../fact/index.js";
import type { EffectiveField, MaterializedField, SchemaFieldItem } from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { schemaExtensionGraph } from "./schema-extension-graph.js";
import {
  configuredFieldItems,
  fieldInitializations,
  projectEffectiveFields,
} from "./schema-field-config.js";

export type SchemaRelations = Readonly<{
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>;
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
}>;

export function deriveSchemaRelations(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  children: ReadonlyMap<string, readonly string[]>,
  initializedFields: Readonly<Record<string, readonly MaterializedField[]>> = {},
): SchemaRelations {
  const applications = observedRelations(active, schemaApplicationEvent, existingNodeIds);
  const fields = observedRelations(active, schemaFieldEvent, existingNodeIds);
  const extensions = observedRelations(active, schemaExtensionEvent, existingNodeIds);
  const schemaApplications = record(applications);
  const schemaFields = record(fields);
  const schemaFieldItems = configuredFieldItems(active, schemaFields);
  const schemaExtensions = record(extensions);
  const extensionGraph = schemaExtensionGraph(schemaExtensions);
  const materializedFields = mergeMaterializedFields(
    materialized(active, existingNodeIds, occurrences, children),
    initializedFields,
  );
  const initializations = fieldInitializations(active);
  return {
    schemaApplications,
    schemaFields,
    schemaFieldItems,
    schemaExtensions,
    schemaSearchMembers: extensionGraph.searchMembers,
    schemaExtensionConflicts: extensionGraph.conflicts,
    effectiveFields: projectEffectiveFields(
      schemaApplications,
      schemaFieldItems,
      schemaExtensions,
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
          fields.findIndex(
            (candidate) => candidate.fieldDefinitionId === field.fieldDefinitionId,
          ) === index,
      ),
    ]),
  );
}

function materialized(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  children: ReadonlyMap<string, readonly string[]>,
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
    const parentNodeId =
      occurrence?.parentOccurrenceId === null
        ? null
        : occurrences.get(occurrence?.parentOccurrenceId ?? "")?.nodeId;
    if (
      !existingNodeIds.has(mutation.ownerNodeId) ||
      !existingNodeIds.has(mutation.fieldNodeId) ||
      occurrence?.nodeId !== mutation.fieldNodeId ||
      parentNodeId !== mutation.ownerNodeId
    ) {
      continue;
    }
    const values = candidates.get(ownerKey) ?? [];
    values.push({ fact, ...mutation });
    candidates.set(ownerKey, values);
  }
  const byOwner = new Map<string, MaterializedField[]>();
  for (const ownerCandidates of [...candidates.values()].sort(compareCandidateGroups)) {
    const available = ownerCandidates
      .sort((left, right) => compareFacts(left.fact, right.fact))
      .filter(
        (candidate) =>
          !claimedNodes.has(candidate.fieldNodeId) &&
          !claimedOccurrences.has(candidate.fieldOccurrenceId),
      );
    const canonical = available[0];
    if (!canonical) {
      continue;
    }
    const valueOccurrenceIds: string[] = [];
    for (const candidate of available) {
      claimedNodes.add(candidate.fieldNodeId);
      claimedOccurrences.add(candidate.fieldOccurrenceId);
      for (const occurrenceId of children.get(candidate.fieldOccurrenceId) ?? []) {
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
): number {
  const leftCandidate = left[0];
  const rightCandidate = right[0];
  if (!leftCandidate || !rightCandidate) {
    return left.length - right.length;
  }
  return (
    stableStringCompare(leftCandidate.ownerNodeId, rightCandidate.ownerNodeId) ||
    stableStringCompare(leftCandidate.fieldDefinitionId, rightCandidate.fieldDefinitionId)
  );
}

type RelationEvent = Readonly<{
  fact: ContributionFact;
  operation: "add" | "remove";
  ownerId: string;
  targetId: string;
  anchor?: SequenceAnchor;
}>;

function observedRelations(
  active: readonly ContributionFact[],
  eventOf: (fact: ContributionFact) => RelationEvent | null,
  existingNodeIds: ReadonlySet<string>,
): Map<string, string[]> {
  const events = active.map(eventOf).filter((event) => event !== null);
  const additions = events.filter((event) => event.operation === "add");
  const removals = events.filter((event) => event.operation === "remove");
  const relations = new Map<string, string[]>();
  for (const addition of additions) {
    if (
      !addition.anchor ||
      !existingNodeIds.has(addition.ownerId) ||
      !existingNodeIds.has(addition.targetId) ||
      removals.some((removal) => {
        return (
          removal.ownerId === addition.ownerId &&
          removal.targetId === addition.targetId &&
          observes(removal.fact, addition.fact)
        );
      })
    ) {
      continue;
    }
    insertUnique(list(relations, addition.ownerId), addition.targetId, addition.anchor);
  }
  return relations;
}

function schemaApplicationEvent(fact: ContributionFact): RelationEvent | null {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "schema-apply" && mutation.kind !== "schema-remove") {
    return null;
  }
  return {
    fact,
    operation: mutation.kind === "schema-apply" ? "add" : "remove",
    ownerId: mutation.nodeId,
    targetId: mutation.schemaId,
    ...(mutation.kind === "schema-apply" ? { anchor: mutation.anchor } : {}),
  };
}

function schemaFieldEvent(fact: ContributionFact): RelationEvent | null {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "schema-field-add" && mutation.kind !== "schema-field-remove") {
    return null;
  }
  return {
    fact,
    operation: mutation.kind === "schema-field-add" ? "add" : "remove",
    ownerId: mutation.schemaId,
    targetId: mutation.fieldDefinitionId,
    ...(mutation.kind === "schema-field-add" ? { anchor: mutation.anchor } : {}),
  };
}

function schemaExtensionEvent(fact: ContributionFact): RelationEvent | null {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "schema-extension-add" && mutation.kind !== "schema-extension-remove") {
    return null;
  }
  return {
    fact,
    operation: mutation.kind === "schema-extension-add" ? "add" : "remove",
    ownerId: mutation.schemaId,
    targetId: mutation.baseSchemaId,
    ...(mutation.kind === "schema-extension-add" ? { anchor: mutation.anchor } : {}),
  };
}

function observes(observer: ContributionFact, observed: ContributionFact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}

function recordFields(
  values: ReadonlyMap<string, readonly MaterializedField[]>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  return Object.fromEntries(
    [...values]
      .filter(([, entries]) => entries.length > 0)
      .sort(([left], [right]) => stableStringCompare(left, right)),
  );
}

function list(map: Map<string, string[]>, key: string): string[] {
  const value = map.get(key) ?? [];
  map.set(key, value);
  return value;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}

function insertUnique(values: string[], value: string, anchor: SequenceAnchor): void {
  remove(values, value);
  const after = anchor.after === null ? -1 : values.indexOf(anchor.after);
  const before = anchor.before === null ? -1 : values.indexOf(anchor.before);
  const index =
    after >= 0 ? after + 1 : before >= 0 ? before : anchor.fallback === "start" ? 0 : values.length;
  values.splice(index, 0, value);
}

function record(
  values: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...values]
      .filter(([, entries]) => entries.length > 0)
      .sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
