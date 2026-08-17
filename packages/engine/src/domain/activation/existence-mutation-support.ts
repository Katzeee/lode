import { fieldDefinitionEndpointOccurrenceId, type Mutation } from "../fact/index.js";

export type ExistenceSupport = Readonly<{
  nodes: ReadonlyMap<string, readonly string[]>;
  occurrences: ReadonlyMap<string, readonly string[]>;
  viable: ReadonlySet<string>;
}>;

export function addOccurrenceChangeSupport(
  support: Set<string>,
  occurrenceSupport: ReadonlyMap<string, readonly string[]>,
  nodeSupport: ReadonlyMap<string, readonly string[]>,
  viable: ReadonlySet<string>,
  mutation: Extract<Mutation, { kind: "occurrence-delete" | "occurrence-move" }>,
): void {
  addIfPresent(support, effectiveCandidate(occurrenceSupport, mutation.occurrenceId, viable));
  if (mutation.kind === "occurrence-move") {
    addIfPresent(support, effectiveCandidate(nodeSupport, mutation.parentNodeId, viable));
  }
}

export function addMaterializedFieldSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
  existence: ExistenceSupport,
): void {
  for (const nodeId of [mutation.ownerNodeId, mutation.fieldDefinitionId, mutation.fieldNodeId]) {
    addIfPresent(support, effectiveCandidate(existence.nodes, nodeId, existence.viable));
  }
  addIfPresent(support, effectiveCandidate(existence.occurrences, mutation.fieldOccurrenceId, existence.viable));
  addIfPresent(
    support,
    effectiveCandidate(
      existence.occurrences,
      fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId),
      existence.viable,
    ),
  );
}

function addIfPresent(target: Set<string>, value: string | undefined): void {
  if (value !== undefined) {
    target.add(value);
  }
}

function effectiveCandidate(
  candidatesByIdentity: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): string | undefined {
  const candidates = candidatesByIdentity.get(identity);
  return candidates?.find((candidate) => viable.has(candidate)) ?? candidates?.[0];
}
