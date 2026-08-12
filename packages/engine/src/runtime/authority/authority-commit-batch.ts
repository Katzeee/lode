import {
  makeFact,
  normalizeFrontier,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type ReplicaId,
  type FactSnapshot,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { AuthorityCommit } from "./fact-store.js";
import { maxLamportAtFrontier, nextReplicaSequence } from "./loro-authority-records.js";

export function createAuthorityCommitBatch(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  input: AuthorityCommit,
  requestDigest: string,
  before: FactSnapshot,
): Readonly<{
  facts: readonly Fact[];
  receipt: AuthorityReceipt;
  records: readonly AuthorityRecord[];
}> {
  let sequence = nextReplicaSequence(before.facts, replicaId);
  let observed = before.frontier;
  let lamport = maxLamportAtFrontier(before.facts, observed) + 1;
  const facts: Fact[] = [];
  for (const body of input.bodies) {
    facts.push(
      makeFact({
        workspaceId,
        replicaId,
        sequence,
        observed,
        lamport,
        body,
      }),
    );
    observed = normalizeFrontier({ ...observed, [replicaId]: sequence });
    sequence += 1;
    lamport += 1;
  }
  const receipt: AuthorityReceipt = {
    workspaceId,
    replicaId,
    invocationId: input.invocationId,
    requestDigest,
    factIds: facts.map((fact) => fact.id),
    committedFrontier: observed,
    lineage: input.lineage,
  };
  return {
    facts,
    receipt,
    records: [
      ...facts.map((fact): AuthorityRecord => ({ recordKind: "fact", fact })),
      { recordKind: "receipt", receipt },
    ],
  };
}
