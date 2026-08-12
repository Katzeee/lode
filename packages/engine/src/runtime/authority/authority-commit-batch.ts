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
export function createAuthorityCommitBatch(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  input: AuthorityCommit,
  requestDigest: string,
  before: FactSnapshot,
  maximumLamport: number,
): Readonly<{
  facts: readonly Fact[];
  receipt: AuthorityReceipt;
  records: readonly AuthorityRecord[];
}> {
  let sequence = (before.frontier[replicaId] ?? 0) + 1;
  let observed = before.frontier;
  let lamport = maximumLamport + 1;
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
