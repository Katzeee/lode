import { compareFacts, type ContributionFact } from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";
import type { TemplateField } from "./projection-types.js";

export function boundSchemaTemplateNodes(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  children: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const removals = active.filter(
    (fact) => fact.body.mutation.kind === "schema-template-node-remove",
  );
  type Binding = { occurrenceId: string; fact: ContributionFact };
  const bySchema = new Map<string, Map<string, Binding>>();
  for (const fact of active
    .filter((candidate) => candidate.body.mutation.kind === "schema-template-node-add")
    .sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "schema-template-node-add") {
      continue;
    }
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.kind === "schema-template-node-remove" &&
        removal.schemaId === mutation.schemaId &&
        removal.templateNodeId === mutation.templateNodeId &&
        removal.templateOccurrenceId === mutation.templateOccurrenceId &&
        observes(candidate, fact)
      );
    });
    const occurrence = occurrences.get(mutation.templateOccurrenceId);
    const creation = occurrenceCreation(active, mutation.templateOccurrenceId);
    if (
      removed ||
      !knownNodeIds.has(mutation.schemaId) ||
      !knownNodeIds.has(mutation.templateNodeId) ||
      creation?.nodeId !== mutation.templateNodeId ||
      creation.parentNodeId !== mutation.schemaId ||
      (occurrence !== undefined &&
        (occurrence.nodeId !== mutation.templateNodeId ||
          occurrence.parentNodeId !== mutation.schemaId))
    ) {
      continue;
    }
    const bindings = bySchema.get(mutation.schemaId) ?? new Map<string, Binding>();
    bindings.set(mutation.templateNodeId, {
      occurrenceId: mutation.templateOccurrenceId,
      fact,
    });
    bySchema.set(mutation.schemaId, bindings);
  }
  return Object.fromEntries(
    [...bySchema].map(([schemaId, bindings]) => {
      const occurrenceIds = children.get(schemaId) ?? [];
      return [
        schemaId,
        [...bindings]
          .sort(([, left], [, right]) => compareBindings(left, right, occurrenceIds))
          .map(([templateNodeId]) => templateNodeId),
      ];
    }),
  );
}

export function boundSchemaFields(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  children: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const additions = active.filter((fact) => fact.body.mutation.kind === "schema-field-add");
  const removals = active.filter((fact) => fact.body.mutation.kind === "schema-field-remove");
  const bySchema = new Map<string, TemplateField[]>();
  for (const fact of additions.sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "schema-field-add") {
      continue;
    }
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.kind === "schema-field-remove" &&
        removal.schemaId === mutation.schemaId &&
        removal.fieldNodeId === mutation.fieldNodeId &&
        removal.fieldOccurrenceId === mutation.fieldOccurrenceId &&
        observes(candidate, fact)
      );
    });
    const occurrence = occurrences.get(mutation.fieldOccurrenceId);
    const creation = occurrenceCreation(active, mutation.fieldOccurrenceId);
    if (
      removed ||
      !knownNodeIds.has(mutation.schemaId) ||
      !knownNodeIds.has(mutation.fieldDefinitionId) ||
      !knownNodeIds.has(mutation.fieldNodeId) ||
      creation?.nodeId !== mutation.fieldNodeId ||
      creation.parentNodeId !== mutation.schemaId ||
      (occurrence !== undefined &&
        (occurrence.nodeId !== mutation.fieldNodeId ||
          occurrence.parentNodeId !== mutation.schemaId))
    ) {
      continue;
    }
    const fields = bySchema.get(mutation.schemaId) ?? [];
    fields.push({
      fieldNodeId: mutation.fieldNodeId,
      fieldOccurrenceId: mutation.fieldOccurrenceId,
      schemaId: mutation.schemaId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      configCandidates: [],
      effectiveConfig: null,
    });
    bySchema.set(mutation.schemaId, fields);
  }
  const entries: (readonly [string, readonly TemplateField[]])[] = [...bySchema.entries()]
    .map(
      ([schemaId, candidates]) =>
        [
          schemaId,
          uniqueFieldsInOccurrenceOrder(candidates, children.get(schemaId) ?? []),
        ] as const,
    )
    .filter((entry) => entry[1].length > 0);
  return Object.fromEntries(entries);
}

function uniqueFieldsInOccurrenceOrder(
  candidates: readonly TemplateField[],
  occurrenceIds: readonly string[],
): readonly TemplateField[] {
  const seenDefinitions = new Set<string>();
  return [...candidates]
    .sort(
      (left, right) =>
        occurrenceIndex(occurrenceIds, left.fieldOccurrenceId) -
        occurrenceIndex(occurrenceIds, right.fieldOccurrenceId),
    )
    .filter((field) => {
      if (seenDefinitions.has(field.fieldDefinitionId)) {
        return false;
      }
      seenDefinitions.add(field.fieldDefinitionId);
      return true;
    });
}

function compareBindings(
  left: { occurrenceId: string; fact: ContributionFact },
  right: { occurrenceId: string; fact: ContributionFact },
  occurrenceIds: readonly string[],
): number {
  const leftIndex = occurrenceIndex(occurrenceIds, left.occurrenceId);
  const rightIndex = occurrenceIndex(occurrenceIds, right.occurrenceId);
  return leftIndex === rightIndex ? compareFacts(left.fact, right.fact) : leftIndex - rightIndex;
}

function occurrenceIndex(occurrenceIds: readonly string[], occurrenceId: string): number {
  const index = occurrenceIds.indexOf(occurrenceId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function observes(observer: ContributionFact, observed: ContributionFact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}

function occurrenceCreation(
  active: readonly ContributionFact[],
  occurrenceId: string,
): Readonly<{ nodeId: string; parentNodeId: string }> | undefined {
  const fact = active.find((candidate) => {
    const mutation = candidate.body.mutation;
    return mutation.kind === "occurrence-create" && mutation.occurrenceId === occurrenceId;
  });
  const mutation = fact?.body.mutation;
  return mutation?.kind === "occurrence-create" ? mutation : undefined;
}
