import {
  isReservedNodeIdentity,
  isReservedOccurrenceIdentity,
  frontierOf,
  makeFact,
  type EditIntent,
  type FactSnapshot,
  type Mutation,
  type PreviousValue,
  type SequenceAnchor,
} from "../../domain/fact/index.js";
import { valueOwnerAddress, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import { applyPlanningMutation } from "./planning-projection.js";
import {
  assertNoBatchCreatedAtomReference,
  prepareTextMark,
  prepareTextSplice,
} from "./text-mutation-planner.js";

export function prepareMutations(
  workspaceId: string,
  mutations: readonly Mutation[],
  generation: ProjectionGeneration,
  intent: EditIntent,
  snapshot: FactSnapshot,
): readonly Mutation[] {
  let workingGeneration = generation;
  let workingSnapshot = snapshot;
  const prepared: Mutation[] = [];
  const batchCreatedAtomIds = new Set<string>();
  for (const [index, mutation] of mutations.entries()) {
    assertNoBatchCreatedAtomReference(mutation, batchCreatedAtomIds);
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    const next = prepareMutation(mutation, previous, workingGeneration.review, workingSnapshot);
    prepared.push(next);
    if (index === mutations.length - 1) {
      continue;
    }
    const sequence = (workingSnapshot.frontier[PLANNING_REPLICA] ?? 0) + 1;
    const fact = makeFact({
      workspaceId,
      replicaId: PLANNING_REPLICA,
      sequence,
      observed: workingSnapshot.frontier,
      lamport: maxLamport(workingSnapshot) + 1 + index,
      body: { kind: "contribution", actorId: "planner", intent, mutation: next },
    });
    if (next.kind === "text-splice") {
      [...next.insert].forEach((_, atomIndex) => {
        batchCreatedAtomIds.add(`${fact.id}#${atomIndex}`);
      });
    }
    const facts = [...workingSnapshot.facts, fact];
    workingSnapshot = { facts, frontier: frontierOf(facts) };
    workingGeneration = applyPlanningMutation(
      workingGeneration,
      next,
      fact.id,
      intent,
      workingSnapshot,
    );
  }
  return prepared;
}

const PLANNING_REPLICA = "77777777777777777777777777";

function maxLamport(snapshot: FactSnapshot): number {
  return snapshot.facts.reduce((maximum, fact) => Math.max(maximum, fact.coordinate.lamport), 0);
}

function prepareMutation(
  mutation: Mutation,
  previous: ProjectionGeneration["review"],
  available: ProjectionGeneration["review"],
  snapshot: FactSnapshot,
): Mutation {
  switch (mutation.kind) {
    case "text-splice":
      return prepareTextSplice(mutation, available);
    case "text-mark":
      return prepareTextMark(mutation, previous, available);
    case "value-set":
    case "value-unset":
      return prepareValue(mutation, previous, available);
    case "occurrence-move": {
      const occurrence = available.occurrences[mutation.occurrenceId];
      if (
        !occurrence ||
        (mutation.parentOccurrenceId !== null &&
          !available.occurrences[mutation.parentOccurrenceId])
      ) {
        throw new Error(`Move target Occurrence does not exist: ${mutation.occurrenceId}`);
      }
      if (createsCycle(available, mutation.occurrenceId, mutation.parentOccurrenceId)) {
        throw new Error("Move would create an Occurrence storage cycle");
      }
      const prior = previous.occurrences[mutation.occurrenceId] ?? occurrence;
      return {
        ...mutation,
        previousParentOccurrenceId: prior?.parentOccurrenceId ?? null,
        previousAnchor: prior
          ? anchorFor(
              previous.occurrences[mutation.occurrenceId] ? previous : available,
              mutation.occurrenceId,
            )
          : mutation.anchor,
      };
    }
    case "occurrence-delete": {
      const occurrence = available.occurrences[mutation.occurrenceId];
      if (!occurrence) {
        throw new Error(`Delete target Occurrence does not exist: ${mutation.occurrenceId}`);
      }
      return {
        ...mutation,
        previousParentOccurrenceId:
          previous.occurrences[mutation.occurrenceId]?.parentOccurrenceId ??
          occurrence?.parentOccurrenceId ??
          null,
        previousAnchor: anchorFor(
          previous.occurrences[mutation.occurrenceId] ? previous : available,
          mutation.occurrenceId,
        ),
      };
    }
    case "canonical-occurrence-set": {
      const occurrence = available.occurrences[mutation.occurrenceId];
      if (!occurrence || (occurrence && occurrence.nodeId !== mutation.nodeId)) {
        throw new Error("Canonical target is not an observed Occurrence of the Node");
      }
      return {
        ...mutation,
        previousOccurrenceId: previous.canonicalOccurrences[mutation.nodeId] ?? null,
      };
    }
    case "node-delete":
      if (!available.nodes[mutation.nodeId]) {
        throw new Error(`Delete target Node does not exist: ${mutation.nodeId}`);
      }
      return mutation;
    case "node-restore":
      assertDeletion(snapshot, mutation.deletionFactId, "node-delete", mutation.nodeId);
      return mutation;
    case "occurrence-create":
      if (isReservedOccurrenceIdentity(mutation.occurrenceId)) {
        throw new Error("Occurrence identity is reserved for derived structure");
      }
      if (!available.nodes[mutation.nodeId]) {
        throw new Error(`Occurrence target Node does not exist: ${mutation.nodeId}`);
      }
      assertParent(available, mutation.parentOccurrenceId);
      return mutation;
    case "occurrence-restore":
      assertDeletion(snapshot, mutation.deletionFactId, "occurrence-delete", mutation.occurrenceId);
      assertParent(available, mutation.parentOccurrenceId);
      return mutation;
    case "node-create":
      if (isReservedNodeIdentity(mutation.nodeId)) {
        throw new Error("Node identity is reserved for managed children");
      }
      return mutation;
  }
}

function createsCycle(
  projection: ProjectionGeneration["review"],
  occurrenceId: string,
  parentOccurrenceId: string | null,
): boolean {
  let current = parentOccurrenceId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === occurrenceId || visited.has(current)) {
      return true;
    }
    visited.add(current);
    current = projection.occurrences[current]?.parentOccurrenceId ?? null;
  }
  return false;
}

function prepareValue(
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
  previous: ProjectionGeneration["review"],
  available: ProjectionGeneration["review"],
): Mutation {
  if (mutation.owner.kind === "node" && !available.nodes[mutation.owner.id]) {
    throw new Error(`Value target Node does not exist: ${mutation.owner.id}`);
  }
  if (mutation.owner.kind === "occurrence" && !available.occurrences[mutation.owner.id]) {
    throw new Error(`Value target Occurrence does not exist: ${mutation.owner.id}`);
  }
  return { ...mutation, previous: previousValue(readValue(previous, mutation)) };
}

function assertDeletion(
  snapshot: FactSnapshot,
  deletionFactId: string,
  kind: "node-delete" | "occurrence-delete",
  identity: string,
): void {
  const deletion = snapshot.facts.find((fact) => fact.id === deletionFactId);
  const mutation = deletion?.body.kind === "contribution" ? deletion.body.mutation : null;
  const matches =
    kind === "node-delete"
      ? mutation?.kind === "node-delete" && mutation.nodeId === identity
      : mutation?.kind === "occurrence-delete" && mutation.occurrenceId === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}

function assertParent(
  projection: ProjectionGeneration["review"],
  parentOccurrenceId: string | null,
): void {
  if (parentOccurrenceId !== null && !projection.occurrences[parentOccurrenceId]) {
    throw new Error(`Parent Occurrence does not exist: ${parentOccurrenceId}`);
  }
}

function readValue(
  projection: ProjectionGeneration["review"],
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
) {
  if (mutation.owner.kind === "node") {
    const node = projection.nodes[mutation.owner.id];
    return mutation.namespace === "metadata"
      ? node?.metadata[mutation.key]
      : node?.properties[mutation.key];
  }
  if (mutation.owner.kind === "occurrence") {
    const occurrence = projection.occurrences[mutation.owner.id];
    return mutation.namespace === "metadata"
      ? occurrence?.metadata[mutation.key]
      : occurrence?.properties[mutation.key];
  }
  const address = valueOwnerAddress(mutation.owner, mutation.namespace);
  return projection.addressedValues[address]?.[mutation.key];
}

function previousValue(value: ReturnType<typeof readValue>): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}

function anchorFor(
  projection: ProjectionGeneration["review"],
  occurrenceId: string,
): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = projection.children[occurrence?.parentOccurrenceId ?? "$root"] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}
