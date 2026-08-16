import { compareFacts, contributionFactsOfKind, factObserves, type ContributionFact } from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";
import type { TemplateField } from "./projection-types.js";

export function boundSupertagTemplateNodes(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const removals = contributionFactsOfKind(active, "supertag-template-node-remove");
  type Binding = { occurrenceId: string; fact: ContributionFact };
  const bySupertag = new Map<string, Map<string, Binding>>();
  for (const fact of [...contributionFactsOfKind(active, "supertag-template-node-add")].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.supertagId === mutation.supertagId &&
        removal.templateNodeId === mutation.templateNodeId &&
        removal.templateOccurrenceId === mutation.templateOccurrenceId &&
        factObserves(candidate, fact)
      );
    });
    const occurrence = occurrences.get(mutation.templateOccurrenceId);
    const creation = occurrenceCreation(active, mutation.templateOccurrenceId);
    if (
      removed ||
      !knownNodeIds.has(mutation.supertagId) ||
      !knownNodeIds.has(mutation.templateNodeId) ||
      creation?.nodeId !== mutation.templateNodeId ||
      creation?.parentNodeId !== mutation.supertagId ||
      (occurrence !== undefined &&
        (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId))
    ) {
      continue;
    }
    const bindings = bySupertag.get(mutation.supertagId) ?? new Map<string, Binding>();
    bindings.set(mutation.templateNodeId, {
      occurrenceId: mutation.templateOccurrenceId,
      fact,
    });
    bySupertag.set(mutation.supertagId, bindings);
  }
  return Object.fromEntries(
    [...bySupertag].map(([supertagId, bindings]) => {
      const occurrenceIds = childOccurrences.get(supertagId) ?? [];
      return [
        supertagId,
        [...bindings]
          .sort(([, left], [, right]) => compareBindings(left, right, occurrenceIds))
          .map(([templateNodeId]) => templateNodeId),
      ];
    }),
  );
}

export function boundSupertagFields(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const additions = contributionFactsOfKind(active, "supertag-field-add");
  const removals = contributionFactsOfKind(active, "supertag-field-remove");
  const bySupertag = new Map<string, TemplateField[]>();
  for (const fact of [...additions].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.supertagId === mutation.supertagId &&
        removal.fieldNodeId === mutation.fieldNodeId &&
        removal.fieldOccurrenceId === mutation.fieldOccurrenceId &&
        factObserves(candidate, fact)
      );
    });
    const occurrence = occurrences.get(mutation.fieldOccurrenceId);
    const creation = occurrenceCreation(active, mutation.fieldOccurrenceId);
    if (
      removed ||
      !knownNodeIds.has(mutation.supertagId) ||
      !knownNodeIds.has(mutation.fieldDefinitionId) ||
      !knownNodeIds.has(mutation.fieldNodeId) ||
      creation?.nodeId !== mutation.fieldNodeId ||
      creation?.parentNodeId !== mutation.supertagId ||
      (occurrence !== undefined &&
        (occurrence.nodeId !== mutation.fieldNodeId || occurrence.parentNodeId !== mutation.supertagId))
    ) {
      continue;
    }
    const fields = bySupertag.get(mutation.supertagId) ?? [];
    fields.push({
      fieldNodeId: mutation.fieldNodeId,
      fieldOccurrenceId: mutation.fieldOccurrenceId,
      supertagId: mutation.supertagId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      configCandidates: [],
      effectiveConfig: null,
    });
    bySupertag.set(mutation.supertagId, fields);
  }
  const entries: (readonly [string, readonly TemplateField[]])[] = [...bySupertag.entries()]
    .map(
      ([supertagId, candidates]) =>
        [supertagId, uniqueFieldsInOccurrenceOrder(candidates, childOccurrences.get(supertagId) ?? [])] as const,
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

function occurrenceCreation(
  active: readonly ContributionFact[],
  occurrenceId: string,
): Readonly<{ nodeId: string; parentNodeId: string }> | undefined {
  return contributionFactsOfKind(active, "occurrence-create").find(
    (candidate) => candidate.body.mutation.occurrenceId === occurrenceId,
  )?.body.mutation;
}
