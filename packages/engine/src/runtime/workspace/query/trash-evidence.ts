import type { TrashEvidenceQueryRequest, TrashEvidenceResult } from "@lode/sdk";
import type { ContributionFact, Fact, FactSnapshot } from "../../../domain/fact/index.js";
import { nodeLocation } from "../../../domain/reconcile/index.js";
import type { ProjectionGenerationReader } from "../../materialization/index.js";

type OwnerSetEvidence = Extract<ContributionFact["body"]["mutation"], { kind: "node-owner-set" }>;
type MoveEvidence = Extract<ContributionFact["body"]["mutation"], { kind: "occurrence-move" }>;

/**
 * Narrow read behind `node restore`: the projection shows a trashed node but
 * never the deletion Fact identity or the placement it came from, and a
 * node-restore edit requires exactly that evidence. The deletion transaction
 * recorded both in its node-owner-set / occurrence-move members.
 */
export async function queryTrashEvidence(
  query: TrashEvidenceQueryRequest,
  generationId: string,
  snapshot: FactSnapshot,
  projections: ProjectionGenerationReader,
): Promise<TrashEvidenceResult> {
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const unavailable: TrashEvidenceResult = {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    nodeId: query.nodeId,
    available: false,
    deletionFactId: "",
    occurrenceId: "",
    previousOwnerNodeId: "",
    previousParentNodeId: "",
    previousAnchor: null,
  };
  const trashNodeId = projection.workspaceSystemNodes.trash;
  if (
    trashNodeId === undefined ||
    nodeLocation(projection.identity.workspaceNodeId, projection, query.nodeId) !== "trash"
  ) {
    return unavailable;
  }
  const occurrence = Object.values(projection.occurrences).find(
    (candidate) => candidate.nodeId === query.nodeId && candidate.parentNodeId === trashNodeId,
  );
  const deletion = latestUnrestoredDeletion(snapshot.facts, query.nodeId);
  if (occurrence === undefined || deletion === undefined) {
    return unavailable;
  }
  const transaction = transactionMembers(snapshot.facts, deletion);
  const ownerEvidence = transaction
    .map(ownerSetMutation)
    .find((mutation) => mutation !== null && mutation.nodeId === query.nodeId && mutation.ownerNodeId === trashNodeId);
  const moveEvidence = transaction
    .map(moveMutation)
    .find((mutation) => mutation !== null && mutation.occurrenceId === occurrence.occurrenceId);
  if (
    ownerEvidence == null ||
    ownerEvidence.previousOwnerNodeId == null ||
    moveEvidence == null ||
    moveEvidence.previousParentNodeId == null
  ) {
    return unavailable;
  }
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    nodeId: query.nodeId,
    available: true,
    deletionFactId: deletion.id,
    occurrenceId: occurrence.occurrenceId,
    previousOwnerNodeId: ownerEvidence.previousOwnerNodeId,
    previousParentNodeId: moveEvidence.previousParentNodeId,
    previousAnchor: moveEvidence.previousAnchor ?? null,
  };
}

function ownerSetMutation(fact: Fact): OwnerSetEvidence | null {
  return fact.body.kind === "contribution" && fact.body.mutation.kind === "node-owner-set" ? fact.body.mutation : null;
}

function moveMutation(fact: Fact): MoveEvidence | null {
  return fact.body.kind === "contribution" && fact.body.mutation.kind === "occurrence-move" ? fact.body.mutation : null;
}

function latestUnrestoredDeletion(facts: readonly Fact[], nodeId: string): ContributionFact | undefined {
  const restored = new Set(
    facts.flatMap((fact) =>
      fact.body.kind === "contribution" && fact.body.mutation.kind === "node-restore"
        ? [fact.body.mutation.deletionFactId]
        : [],
    ),
  );
  return facts
    .filter(
      (fact): fact is ContributionFact =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "node-delete" &&
        fact.body.mutation.nodeId === nodeId &&
        !restored.has(fact.id),
    )
    .at(-1);
}

function transactionMembers(facts: readonly Fact[], target: ContributionFact): readonly Fact[] {
  return target.transaction === undefined
    ? [target]
    : facts.filter((fact) => fact.transaction?.transactionId === target.transaction?.transactionId);
}
