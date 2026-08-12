import {
  canonicalJson,
  INITIALIZED_FIELD_NODE_PREFIX,
  INITIALIZED_FIELD_OCCURRENCE_PREFIX,
  stableStringCompare,
  type ContributionFact,
} from "../fact/index.js";
import type { MaterializedField, TextAtom } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";

export function projectInitializedFields(
  active: readonly ContributionFact[],
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  canonicalOccurrences: Readonly<Record<string, string>>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  removeInitializedOutputs(nodes, occurrences, children);
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
      candidates.flatMap((candidate) =>
        candidate.body.mutation.kind === "field-initialize"
          ? [[canonicalJson(candidate.body.mutation.values), candidate] as const]
          : [],
      ),
    );
    if (distinct.size !== 1) {
      continue;
    }
    const source = [...distinct.values()][0];
    if (!source || source.body.mutation.kind !== "field-initialize") {
      continue;
    }
    const mutation = source.body.mutation;
    const parentOccurrenceId = canonicalOccurrences[mutation.ownerNodeId];
    if (!nodes.has(mutation.ownerNodeId) || !parentOccurrenceId) {
      continue;
    }
    const fieldNodeId = initializedFieldNodeId(mutation.ownerNodeId, mutation.fieldDefinitionId);
    const fieldOccurrenceId = initializedFieldOccurrenceId(
      mutation.ownerNodeId,
      mutation.fieldDefinitionId,
    );
    nodes.set(fieldNodeId, {
      nodeId: fieldNodeId,
      text: [],
      properties: { fieldDefinitionId: mutation.fieldDefinitionId },
      metadata: { initializedBy: mutation.source },
    });
    occurrences.set(fieldOccurrenceId, {
      occurrenceId: fieldOccurrenceId,
      nodeId: fieldNodeId,
      parentOccurrenceId,
      properties: {},
      metadata: { initializedBy: mutation.source },
      managed: false,
    });
    appendUnique(childList(children, parentOccurrenceId), fieldOccurrenceId);
    const valueOccurrenceIds = mutation.values.flatMap((seed, index) => {
      const occurrenceId = initializedValueOccurrenceId(fieldOccurrenceId, index);
      const nodeId =
        seed.kind === "reference" ? seed.nodeId : initializedValueNodeId(fieldNodeId, index);
      if (seed.kind === "text") {
        nodes.set(nodeId, {
          nodeId,
          text: textAtoms(source.id, index, seed.value),
          properties: {},
          metadata: { initializedBy: mutation.source },
        });
      }
      if (!nodes.has(nodeId)) {
        return [];
      }
      occurrences.set(occurrenceId, {
        occurrenceId,
        nodeId,
        parentOccurrenceId: fieldOccurrenceId,
        properties: {},
        metadata: seed.kind === "reference" ? { reference: true } : {},
        managed: false,
      });
      childList(children, fieldOccurrenceId).push(occurrenceId);
      return [occurrenceId];
    });
    const ownerFields = fields.get(mutation.ownerNodeId) ?? [];
    ownerFields.push({
      ownerNodeId: mutation.ownerNodeId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      fieldNodeId,
      fieldOccurrenceId,
      valueOccurrenceIds,
    });
    fields.set(mutation.ownerNodeId, ownerFields);
  }
  return Object.fromEntries(fields);
}

function maximalInitializations(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFact[]> {
  const facts = active.filter((fact) => fact.body.mutation.kind === "field-initialize");
  const superseded = new Set(
    facts.flatMap((fact) =>
      fact.body.mutation.kind === "field-initialize"
        ? (fact.body.mutation.observedInitializationFactIds ?? [])
        : [],
    ),
  );
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of facts.filter((candidate) => !superseded.has(candidate.id))) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "field-initialize") {
      continue;
    }
    const key = canonicalJson([mutation.ownerNodeId, mutation.fieldDefinitionId]);
    const values = groups.get(key) ?? [];
    values.push(fact);
    values.sort((left, right) => stableStringCompare(left.id, right.id));
    groups.set(key, values);
  }
  return groups;
}

function initializedFieldNodeId(ownerNodeId: string, fieldDefinitionId: string): string {
  return `${INITIALIZED_FIELD_NODE_PREFIX}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(fieldDefinitionId)}`;
}

function initializedFieldOccurrenceId(ownerNodeId: string, fieldDefinitionId: string): string {
  return `${INITIALIZED_FIELD_OCCURRENCE_PREFIX}${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(fieldDefinitionId)}`;
}

function initializedValueNodeId(fieldNodeId: string, index: number): string {
  return `${fieldNodeId}:value:${index}`;
}

function initializedValueOccurrenceId(fieldOccurrenceId: string, index: number): string {
  return `${fieldOccurrenceId}:value:${index}`;
}

function textAtoms(contributionId: string, valueIndex: number, value: string): TextAtom[] {
  return [...value].map((character, index) => ({
    id: `${contributionId}:value:${valueIndex}#${index}`,
    value: character,
    attributes: {},
    contributionId,
  }));
}

function removeInitializedOutputs(
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  for (const nodeId of [...nodes.keys()]) {
    if (nodeId.startsWith(INITIALIZED_FIELD_NODE_PREFIX)) {
      nodes.delete(nodeId);
    }
  }
  const removedOccurrences = new Set(
    [...occurrences.keys()].filter((identity) =>
      identity.startsWith(INITIALIZED_FIELD_OCCURRENCE_PREFIX),
    ),
  );
  for (const occurrenceId of removedOccurrences) {
    occurrences.delete(occurrenceId);
    children.delete(occurrenceId);
  }
  for (const [parent, values] of children) {
    children.set(
      parent,
      values.filter((identity) => !removedOccurrences.has(identity)),
    );
  }
}

function childList(children: Map<string, string[]>, parentOccurrenceId: string): string[] {
  const values = children.get(parentOccurrenceId) ?? [];
  children.set(parentOccurrenceId, values);
  return values;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
