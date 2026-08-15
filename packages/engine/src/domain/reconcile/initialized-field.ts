import {
  canonicalJson,
  contributionFactsOfKind,
  stableStringCompare,
  type ContributionFact,
  type ContributionFactOf,
  type FieldValueSeed,
  type InitializedFieldValue,
} from "../fact/index.js";
import type { MaterializedField } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";

export function projectInitializedFields(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  const groups = maximalInitializations(active);
  const explicitFields = new Set(
    active.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "field-materialize"
        ? [canonicalJson([mutation.ownerNodeId, mutation.fieldDefinitionId])]
        : [];
    }),
  );
  const fields = new Map<string, MaterializedField[]>();
  for (const [key, candidates] of groups) {
    if (explicitFields.has(key)) {
      continue;
    }
    const distinct = new Map(
      candidates.flatMap((candidate) => {
        const mutation = candidate.body.mutation;
        return [[canonicalJson(mutation.values.map(fieldValueSeed)), candidate] as const];
      }),
    );
    if (distinct.size !== 1) {
      continue;
    }
    const source = [...distinct.values()][0];
    if (!source) {
      continue;
    }
    const mutation = source.body.mutation;
    const fieldOccurrence = occurrences.get(mutation.fieldOccurrenceId);
    if (
      !nodes.has(mutation.ownerNodeId) ||
      !(mutation.ownerNodeId in nodeOwners) ||
      !nodes.has(mutation.fieldNodeId) ||
      fieldOccurrence?.nodeId !== mutation.fieldNodeId ||
      fieldOccurrence.parentNodeId !== mutation.ownerNodeId
    ) {
      continue;
    }
    const ownerFields = fields.get(mutation.ownerNodeId) ?? [];
    ownerFields.push({
      ownerNodeId: mutation.ownerNodeId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      fieldNodeId: mutation.fieldNodeId,
      fieldOccurrenceId: mutation.fieldOccurrenceId,
      valueOccurrenceIds: mutation.values.flatMap((value) => {
        const occurrence = occurrences.get(value.occurrenceId);
        return occurrence?.nodeId === value.nodeId && occurrence.parentNodeId === mutation.fieldNodeId
          ? [value.occurrenceId]
          : [];
      }),
    });
    fields.set(mutation.ownerNodeId, ownerFields);
  }
  return Object.fromEntries(fields);
}

export function fieldValueSeed(value: InitializedFieldValue): FieldValueSeed {
  return value.kind === "text" ? { kind: "text", value: value.value } : { kind: "reference", nodeId: value.nodeId };
}

function maximalInitializations(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFactOf<"field-initialize">[]> {
  const facts = contributionFactsOfKind(active, "field-initialize");
  const superseded = new Set(facts.flatMap((fact) => fact.body.mutation.observedInitializationFactIds ?? []));
  const groups = new Map<string, ContributionFactOf<"field-initialize">[]>();
  for (const fact of facts.filter((candidate) => !superseded.has(candidate.id))) {
    const mutation = fact.body.mutation;
    const key = canonicalJson([mutation.ownerNodeId, mutation.fieldDefinitionId]);
    const values = groups.get(key) ?? [];
    values.push(fact);
    values.sort((left, right) => stableStringCompare(left.id, right.id));
    groups.set(key, values);
  }
  return groups;
}
