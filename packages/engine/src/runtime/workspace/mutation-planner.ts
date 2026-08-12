import {
  isReservedNodeIdentity,
  isReservedOccurrenceIdentity,
  frontierOf,
  makeFact,
  type EditIntent,
  type FactSnapshot,
  type Mutation,
  type PreviousValue,
} from "../../domain/fact/index.js";
import {
  assertMaterializedField,
  valueOwnerAddress,
  type ProjectionGeneration,
} from "../../domain/reconcile/index.js";
import { applyPlanningMutation } from "./planning-projection.js";
import { prepareSchemaMutation } from "./planning-schema-relations.js";
import {
  prepareFieldInitialization,
  schemaApplicationInitializations,
} from "./field-initialization-planner.js";
import {
  assertNoBatchCreatedAtomReference,
  prepareTextMark,
  prepareTextSplice,
} from "./text-mutation-planner.js";
import { prepareTemplateDetachment } from "./template-node-mutation-planner.js";
import { prepareFieldContentDeletion } from "./field-content-deletion-planner.js";
import { assertSingleRoot, prepareMutableOccurrence } from "./occurrence-mutation-planner.js";

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
  const pending = [...mutations];
  for (let index = 0; index < pending.length; index += 1) {
    const mutation = pending[index];
    if (!mutation) {
      continue;
    }
    assertNoBatchCreatedAtomReference(mutation, batchCreatedAtomIds);
    const previous = intent === "direct" ? workingGeneration.origin : workingGeneration.review;
    const next = prepareMutation(mutation, previous, workingGeneration.review, workingSnapshot);
    if (next.kind === "schema-apply") {
      pending.splice(
        index + 1,
        0,
        ...schemaApplicationInitializations(next, workingGeneration.review),
      );
    }
    prepared.push(next);
    const sequence = (workingSnapshot.frontier[PLANNING_REPLICA] ?? 0) + 1;
    const lamport = maxLamport(workingSnapshot);
    const fact = makeFact({
      workspaceId,
      replicaId: PLANNING_REPLICA,
      sequence,
      observed: workingSnapshot.frontier,
      lamport: lamport + 1 + index,
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
  assertSingleRoot(intent === "direct" ? workingGeneration.origin : workingGeneration.review);
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
  if (isSchemaMutation(mutation)) {
    return prepareSchemaMutation(mutation, available);
  }
  if (isFieldContentDeletion(mutation)) {
    return prepareFieldContentDeletion(mutation, previous, available);
  }
  const preparedOccurrence = prepareMutableOccurrence(mutation, previous, available);
  if (preparedOccurrence) {
    return preparedOccurrence;
  }
  switch (mutation.kind) {
    case "text-splice":
      return prepareTextSplice(mutation, available);
    case "text-mark":
      return prepareTextMark(mutation, previous, available);
    case "value-set":
    case "value-unset":
      return prepareValue(mutation, previous, available);
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
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return mutation;
    case "field-initialize":
      return prepareFieldInitialization(mutation, available);
    case "template-node-detach":
      return prepareTemplateDetachment(mutation, available);
    case "occurrence-move":
    case "occurrence-delete":
      return prepareMutableOccurrence(mutation, previous, available) ?? mutation;
    case "node-create":
      return prepareNodeCreate(mutation);
  }
}

function prepareNodeCreate(mutation: Extract<Mutation, { kind: "node-create" }>): Mutation {
  if (isReservedNodeIdentity(mutation.nodeId)) {
    throw new Error("Node identity is reserved for managed children");
  }
  return mutation;
}

function isSchemaMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
}

function isFieldContentDeletion(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: "field-value-delete" | "materialized-field-delete" }> {
  return mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete";
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
      : occurrenceDeletionIdentity(mutation) === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}

function occurrenceDeletionIdentity(mutation: Mutation | null): string | null {
  if (mutation?.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation?.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation?.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
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
