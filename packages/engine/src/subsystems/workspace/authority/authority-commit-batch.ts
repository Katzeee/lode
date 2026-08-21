import {
  makeFact,
  factTransactionId,
  normalizeFrontier,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type ReplicaId,
  type FactSnapshot,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { AuthorityCommit } from "./authority-contract.js";
export function createAuthorityCommitBatch(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  input: AuthorityCommit,
  requestDigest: string,
  before: FactSnapshot,
  maximumLamport: number,
  signFact?: (digest: string, actorId: string) => string,
): Readonly<{
  facts: readonly Fact[];
  receipt: AuthorityReceipt;
  records: readonly AuthorityRecord[];
}> {
  let sequence = (before.frontier[replicaId] ?? 0) + 1;
  let observed = before.frontier;
  let lamport = maximumLamport + 1;
  const facts: Fact[] = [];
  for (const write of input.writes) {
    const bodies = write.kind === "transaction" ? write.bodies : [write];
    const transactionId = factTransactionId(workspaceId, replicaId, sequence);
    for (const [index, body] of bodies.entries()) {
      const fact = makeFact({
        workspaceId,
        replicaId,
        sequence,
        observed,
        lamport,
        transaction: { transactionId, index, size: bodies.length },
        body,
      });
      facts.push(signFact ? withAttribution(fact, signFact(fact.contentDigest, body.actorId)) : fact);
      observed = normalizeFrontier({ ...observed, [replicaId]: sequence });
      sequence += 1;
      lamport += 1;
    }
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

function withAttribution(fact: Fact, signature: string): Fact {
  return { ...fact, attribution: signature };
}
